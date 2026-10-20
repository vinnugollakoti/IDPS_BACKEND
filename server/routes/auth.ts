import express, {Request, Response} from "express";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { randomInt } from "node:crypto";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
import {sendMOtpail} from "../mailer/mail"
import { generateToken } from "../middleware/jwt";
const router = express.Router();

const verifyReviewerPassword = (password: string, stored: string) => {
    const [salt, encoded] = stored.split(":");
    if (!salt || !encoded) return false;
    const expected = Buffer.from(encoded, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// Dedicated reusable Play reviewer login. Credentials stay on the server and
// never ship inside the Android/PWA bundle. Configure both values in Render:
// PLAY_REVIEW_EMAIL and PLAY_REVIEW_PASSWORD_HASH (salt:hex scrypt hash).
router.post("/play-review-login", async (req: Request, res: Response) => {
    try {
        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const password = typeof req.body?.password === "string" ? req.body.password : "";
        const configuredEmail = process.env.PLAY_REVIEW_EMAIL?.trim().toLowerCase();
        const configuredHash = process.env.PLAY_REVIEW_PASSWORD_HASH;
        if (!configuredEmail || !configuredHash || email !== configuredEmail || !verifyReviewerPassword(password, configuredHash)) {
            return res.status(401).json({ message: "Invalid review credentials" });
        }
        const user = await prisma.user.findUnique({ where: { email: configuredEmail }, include: { teacher: true, parent: true, userPermissions: { select: { module: true, isAllowed: true } } } });
        if (!user || user.role !== "CHAIRMAN") return res.status(403).json({ message: "Review account is not configured correctly" });
        const token = generateToken(user.id, user.role);
        const { otp: _otp, otpExpiry: _expiry, ...safeUser } = user;
        // Keep the Play review account away from live fee data even if its
        // permission rows are recreated or missing during a deployment.
        const allowedModules = user.userPermissions.length
            ? user.userPermissions.filter((item) => item.isAllowed && item.module !== "fees").map((item) => item.module)
            : ["students", "circulars", "exams", "classes", "attendance", "timetable", "notifications", "permission", "homework", "whatsapp", "spending", "complaints", "downloads", "profile"];
        return res.json({ message: "Review login successful", token, user: { ...safeUser, photoUrl: user.photoUrl || user.teacher?.photo || undefined, allowedModules } });
    } catch {
        return res.status(401).json({ message: "Invalid review credentials" });
    }
});

router.post("/login", async( req: Request, res: Response) => {
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

        const otp = randomInt(100000, 1000000).toString();
        const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

        await prisma.user.update({
            where : {email},
            data: {
                otp,
                otpExpiry
            }
        });

        await sendMOtpail(email, otp);

        res.json({ message: "OTP Sent, valid for 5 minutes" });
    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error executing login request"});
    }
})

router.post("/otp-verify", async(req: Request, res: Response) => {
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

        if (!user) {
            return res.status(400).json({message: "User not found"});
        }
        if (user.otp !== otp) {
            return res.status(400).json({message: "Invalid OTP"});
        }
        if (!user.otpExpiry || user.otpExpiry < new Date()) {
            return res.status(400).json({message: "OTP expired"});
        }

        const token = generateToken(user.id, user.role);

        await prisma.user.update({
            where: {id: user.id},
            data: {
                otp: null,
                otpExpiry:null
            }
        })

        const { otp: _uOtp, otpExpiry: _uExp, ...safeUser } = user;
        const allowedModules = user.userPermissions.length
            ? user.userPermissions.filter((item) => item.isAllowed).map((item) => item.module)
            : undefined;
        res.json({message: "Logged in Successfully", token, user: { ...safeUser, photoUrl: user.photoUrl || user.teacher?.photo || undefined, allowedModules }}) 

    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Logged in failed due to server, contact developer"});
    }
})



export default router;
