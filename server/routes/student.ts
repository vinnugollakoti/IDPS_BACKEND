import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();


router.post("/create-fee", auth, async(req: AuthRequest, res: Response) => {

    try {
        if (req.user.role !== "PRINCIPAL") {
            return res.status(403).json({message: "Unauthorized request"})
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
            return res.status(404).json({message: "Fee type already existed, you can edit the fee."})
        }

        const result = await prisma.$transaction(async(tx) => {
            const fee = await tx.fee.create({
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
        return res.status(403).json({message: "Error creating Fee details, Contact developer"})
    }
})

router.post("/create-payment", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const {feeId, amount, method, status, screenshot} = req.body;

        if (!feeId || !amount || !method || !status) {
            return res.status(403).json({ message: "Missing required fields" });
        }

        const payment = await prisma.payment.create({
            data: {
                feeId,
                amount: new Prisma.Decimal(amount),
                method,
                status,
                screenshot,
                verifiedById: req.user.id,
                verifiedAt: new Date()
            },

            include: {
                fee: true,
                verifiedBy: true,
            }
        })

        res.json({message: "Successfully created payment", data: payment})

    } catch(err) {
        console.log(err)
        return res.status(403).json({message: "Error creating payment details, Contact developer"})
    }
})



router.put("/update-fee/:id", auth, async(req: AuthRequest, res: Response) => {
    try {

        if (req.user.role !== "PRINCIPAL") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const {type, total, academicYear} = req.body;

        const feeId = Number(req.params.id);

        const fee_ = await prisma.fee.findUnique({
            where: {id: feeId}
        })

        if (!fee_) {
            return res.status(404).json({message: "Fee data not existed, Contact developer"});
        }

        const duplicate = await prisma.fee.findFirst({
            where: {
                studentId: fee_.studentId,
                type,
                academicYear,
                NOT: { id: feeId }
            }
        });

        if (duplicate) {
            return res.status(400).json({
                message: "Fee with same type and academic year already exists for this student"
            });
        }

        const updatedFee = await prisma.fee.update({
            where: {id: feeId},
            data: {
                type,
                total,
                academicYear
            }
        })

        res.json({message: "Fee detailes updated", data: {updatedFee}});
    } catch (err) {
        console.log(err);
        return res.status(403).json({message: "Error in editing fee cetails, Contact developer"});
    }
})


router.put("/update-payment/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        
        if (req.user.role !== "PRINCIPAL") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const {feeId, amount, method, status, screenshot} = req.body;

        const paymentId = Number(req.params.id);

        const payment_ = await prisma.payment.findUnique({
            where : {id: paymentId}
        })

        if (!payment_) {
            return res.status(700).json({message: "Payment data not existed, Contact developer"});
        }

        const updatedPayment = await prisma.payment.update({
            where: {id: paymentId},
            data: {
                feeId,
                amount: new Prisma.Decimal(amount),
                method,
                status,
                screenshot,
                verifiedById: req.user.id
            },

            include: {
                fee: true,
                verifiedBy: true
            }
        })

        res.json({message: "Payment details updated successfully", data: updatedPayment});
    } catch (err) {
        console.log(err)
        return res.status(403).json({message: "Error updating payment details, Contact developer"});
    }
})


// router.get("/get-feedetails/:id", auth, async(req: AuthRequest, res: Response) => {
//     try {
//         if (req.user.role !== "PRINCIPAL") {
//             return res.status(403).json({message: "Unauthorized request"})
//         }

//         const studentId = Number(req.params.id);

//         const existedStudent = await prisma.fee.findUnique({
//             where: {id: studentId},
//             include: {
//                 class: true,
//                 bus: true,
//                 parents: {
//                 include: {
//                     parent: true
//                 }
//                 },
//                 feeDetails: {
//                 include: {
//                     payments: true
//                 }
//                 }
//             }
//         })

//         if (!existedStudent) {
//             return res.status(400).json({message: "Student not existed"});
//         }




//     } catch(err) {

//     }
// })


// const totalPaid = await prisma.payment.aggregate({
//   where: {
//     feeId,
//     status: "SUCCESS" // only successful payments
//   },
//   _sum: {
//     amount: true
//   }
// });

// const paid = totalPaid._sum.amount || 0;

export default router;