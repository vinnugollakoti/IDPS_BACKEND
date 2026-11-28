import express, {Request, Response} from "express";
import { createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { randomInt } from "node:crypto";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
import { MailDeliveryError, sendMOtpail } from "../mailer/mail";
import { generateToken } from "../middleware/jwt";
import { authRateLimit } from "../middleware/authRateLimit";
const router = express.Router();
const limitOtpRequests = authRateLimit({ action: "otp-request", windowMs: 15 * 60_000, max: 3 });
const parentReviewEmail = "play-parent@review.invalid";
const otpDigest = (scope: "parent" | "general", email: string, otp: string) =>
    createHmac("sha256", process.env.JWT_SECRET!).update(JSON.stringify([scope, email, otp])).digest("hex");

async function emailOtp(user: { id: number; email: string }, scope: "parent" | "general") {
    const code = randomInt(100000, 1000000).toString();
    const digest = otpDigest(scope, user.email, code);
    await prisma.user.update({
        where: { id: user.id },
        data: { otp: digest, otpExpiry: new Date(Date.now() + 5 * 60_000) },
    });
    try {
        await sendMOtpail(user.email, code);
    } catch (error) {
        if (error instanceof MailDeliveryError) {
            console.error("OTP relay failure", { scope, reason: error.reason, upstreamStatus: error.upstreamStatus, relayRequestId: error.relayRequestId });
            // The relay may already have delivered the message when its acknowledgement times out.
            if (error.reason === "mail_timeout" || error.upstreamStatus === 504) return "unconfirmed";
        }
        await prisma.user.updateMany({
            where: { id: user.id, otp: digest },
            data: { otp: null, otpExpiry: null },
        });
        throw error;
    }
}

async function consumeOtp(id: number, digest: string) {
    const consumed = await prisma.user.updateMany({
        where: { id, otp: digest, otpExpiry: { gt: new Date() } },
        data: { otp: null, otpExpiry: null },
    });
    return consumed.count === 1;
}

const scryptAsync = promisify(scrypt);
const verifyReviewerPassword = async (password: string, stored: string) => {
    const [salt, encoded] = stored.split(":");
    if (!salt || !/^[a-f0-9]{128}$/.test(encoded || "")) return false;
    const expected = Buffer.from(encoded, "hex");
    const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
    return timingSafeEqual(expected, actual);
};

// Dedicated reusable Play reviewer login. Credentials stay on the server and
// never ship inside the Android/PWA bundle. Configure both values in Render:
// PLAY_REVIEW_EMAIL and PLAY_REVIEW_PASSWORD_HASH (salt:hex scrypt hash).
router.post("/play-review-login", authRateLimit({ action: "review-login", windowMs: 15 * 60 * 1000, max: 10 }), async (req: Request, res: Response) => {
    try {
        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const password = typeof req.body?.password === "string" ? req.body.password : "";
        const configuredEmail = process.env.PLAY_REVIEW_EMAIL?.trim().toLowerCase();
        const configuredHash = process.env.PLAY_REVIEW_PASSWORD_HASH;
        if (!configuredEmail || !configuredHash || email !== configuredEmail || !await verifyReviewerPassword(password, configuredHash)) {
            return res.status(401).json({ message: "Invalid review credentials" });
        }
        const user = await prisma.user.findUnique({ where: { email: configuredEmail }, include: { teacher: true, parent: true, userPermissions: { select: { module: true, isAllowed: true } } } });
        if (!user || user.role !== "CHAIRMAN") return res.status(403).json({ message: "Review account is not configured correctly" });
        const token = generateToken(user.id, user.role);
        // Keep the Play review account away from live fee data even if its
        // permission rows are recreated or missing during a deployment.
        const allowedModules = user.userPermissions.length
            ? user.userPermissions.filter((item) => item.isAllowed && item.module !== "fees").map((item) => item.module)
            : ["students", "circulars", "exams", "classes", "attendance", "timetable", "notifications", "permission", "homework", "whatsapp", "spending", "complaints", "downloads", "profile"];
        return res.json({ message: "Review login successful", token, user: { ...user, photoUrl: user.photoUrl || user.teacher?.photo || undefined, allowedModules } });
    } catch {
        return res.status(401).json({ message: "Invalid review credentials" });
    }
});

router.post("/login", limitOtpRequests, async( req: Request, res: Response) => {
    try {

        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

        if (!email) {
            return res.status(400).json({message: "Email required"});
        }

        const user = await prisma.user.findUnique({
            where: {email}
        })

        if (!user) {
            return res.status(404).json({
                message: "Your account is not registered with IDPS. Please contact your school administration (Principal, Director, or Receptionist) to create your account before logging in.",
                code: "USER_NOT_REGISTERED"
            });
        }

        if (await emailOtp(user, "general") === "unconfirmed") {
            return res.status(202).json({ message: "Delivery is taking longer than usual. Check your email for the sign-in code. It is valid for five minutes from the request." });
        }
        res.json({ message: "OTP Sent, valid for 5 minutes" });
    } catch (err) {
        if (err instanceof MailDeliveryError) {
            return res.status(503).json({ code: "OTP_DELIVERY_UNAVAILABLE", message: "We could not send your sign-in email. Please try again later." });
        }
        const prismaCode = err instanceof Error && "code" in err ? err.code : undefined;
        console.error("Staff login failed", { prismaCode });
        return res.status(500).json({ code: "LOGIN_FAILED", message: "Error executing login request" });
    }
})

router.post("/parent/email-otp/request", limitOtpRequests, async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address" });
    if (email === parentReviewEmail) {
        return res.json({ message: "If a parent account matches that email, a sign-in code has been sent." });
    }
    try {
        const user = await prisma.user.findFirst({ where: { email, role: "PARENT", parent: { isNot: null } }, select: { id: true, email: true } });
        if (user) await emailOtp(user, "parent");
        // Keep account existence private; the code is delivered only for a registered parent.
        return res.json({ message: "If a parent account matches that email, a sign-in code has been sent." });
    } catch (error) {
        console.error("Parent email OTP delivery failed");
        return res.json({ message: "If a parent account matches that email, a sign-in code has been sent." });
    }
});

router.post("/parent/email-otp/verify", authRateLimit({ action: "parent-email-otp-verify", windowMs: 10 * 60 * 1000, max: 10 }), async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: "Enter the email address and six-digit code" });
    }
    try {
        if (email === parentReviewEmail) {
            const hash = process.env.PARENT_PLAY_REVIEW_CODE_HASH || "";
            if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash) || !await verifyReviewerPassword(otp, hash)) {
                return res.status(400).json({ message: "The sign-in code is invalid or expired" });
            }
            const reviewer = await prisma.user.findFirst({
                where: { email, role: "PARENT", parent: { is: { students: {
                    some: {}, every: { student: { studentCode: { in: ["PLAY-REVIEW-A", "PLAY-REVIEW-B"] }, busId: null, class: { name: "Play Review", section: "Sample" } } }
                } } } },
                select: { id: true, name: true, email: true, role: true },
            });
            if (!reviewer) return res.status(503).json({ message: "Review account setup is incomplete" });
            return res.json({ token: generateToken(reviewer.id, "PARENT"), user: reviewer });
        }
        const user = await prisma.user.findFirst({
            where: { email, role: "PARENT", parent: { isNot: null } },
            select: { id: true, name: true, email: true, role: true },
        });
        const candidateHash = otpDigest("parent", email, otp);
        if (!user || !await consumeOtp(user.id, candidateHash)) {
            return res.status(400).json({ message: "The sign-in code is invalid or expired" });
        }
        const token = generateToken(user.id, "PARENT");
        return res.json({ message: "Parent sign-in successful", token, user: { id: user.id, name: user.name, email: user.email, role: "PARENT" } });
    } catch (error) {
        console.error("Parent email OTP verification failed");
        return res.status(503).json({ message: "We could not verify the sign-in code right now. Please try again." });
    }
});

router.post("/otp-verify", authRateLimit({ action: "otp-verify", windowMs: 10 * 60 * 1000, max: 10 }), async(req: Request, res: Response) => {
    try {
        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
        
        const user = await prisma.user.findUnique({
            where: {email},
            include: {
                parent: true,
                teacher: true,
                userPermissions: {
                    select: { module: true, isAllowed: true }
                }
            }
        })

        if (!user || !/^\d{6}$/.test(otp) || !await consumeOtp(user.id, otpDigest("general", email, otp))) {
            return res.status(400).json({ message: "The sign-in code is invalid or expired" });
        }
        const token = generateToken(user.id, user.role);
        const allowedModules = user.userPermissions.length
            ? user.userPermissions.filter((item) => item.isAllowed).map((item) => item.module)
            : undefined;
        res.json({message: "Logged in Successfully", token, user: { ...user, photoUrl: user.photoUrl || user.teacher?.photo || undefined, allowedModules }})

    } catch(err) {
        console.error("Authentication service failed");
        return res.status(500).json({message: "Logged in failed due to server, contact developer"});
    }
})



export default router;
