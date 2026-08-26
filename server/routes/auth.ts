import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
import {sendMOtpail} from "../mailer/mail"
import { generateToken } from "../middleware/jwt";
const router = express.Router();

router.post("/login", async( req: Request, res: Response) => {
    try {

        const {email} = req.body;

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

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

        await prisma.user.update({
            where : {email},
            data: {
                otp,
                otpExpiry
            }
        });

        sendMOtpail(email, otp);

        res.json({ message: "OTP Sent, valid for 5 minutes" });
    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error executing login request"});
    }
})

router.post("/otp-verify", async(req: Request, res: Response) => {
    try {
        const {email, otp} = req.body;
        
        const user = await prisma.user.findUnique({
            where: {email},
            include: {
                parent: true,
                teacher: true
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
        res.json({message: "Logged in Successfully", token, user: safeUser}) 

    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Logged in failed due to server, contact developer"});
    }
})



export default router;