import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();


router.post("/create-fee", auth, async(req: AuthRequest, res: Response) => {

    try {
        if (req.user.role !== "PRINCIPAL") {
            return res.status(400).json({message: "Unauthorized request"})
        }

        const {studentId, type, total, academicYear} = req.body;

        if (!studentId || !type || !total || !academicYear) {
            return res.status(500).json({message: "Missing required fields"});
        }

        const existedFee = await prisma.fee.findUnique({
            where: {
                studentId_type_academicYear: {
                    studentId,
                    type,
                    academicYear
                }
            }
        })

        if(existedFee) {
            return res.status(600).json({message: "Fee type already existed, you can edit the fee."})
        }

        const result = await prisma.$transaction(async(tx) => {
            const fee = tx.fee.create({
                data: {
                    studentId,
                    type,
                    total,
                    academicYear
                },

                include: {
                    student: true,
                    payments: true
                }
            })

            return fee
        })

        res.json({message: "Successfully created fee for student", data: result});
    } catch (err) {
        console.log(err);
        return res.status(400).json({message: "Error creating Fee details, Contact developer"})
    }
})


export default router;