import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();


router.post("/create-student", auth, async( req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "UnAuthorized area"});
        }

        const { photo, name, gender, dob, classId, busId, parentIds } = req.body;

        

        if (!name || !gender || !classId || !parentIds || parentIds.length == 0) {
            return res.status(400).json({message: "Missing required fields"});
        }

        const parents = await prisma.parent.findMany({
            where: { id: { in: parentIds } }
        });

        if (parents.length !== parentIds.length) {
            return res.status(400).json({ message: "Invalid parentId provided" });
        }


        const student = await prisma.student.create({
            data: {
                photo,
                name,
                gender,
                dob,
                classId,
                busId,

                parents : {
                    create: parentIds.map((parentId: number) => ({
                        parent : {
                            connect: {id: parentId}
                        }
                    }))
                }
            },

            include: {
                parents: {
                    include: {
                        parent: true
                    }
                },
                feeDetails: true,
                marks: true,
                attendances: true,
                class: true,
                bus: true
            }
        })
        
        res.json({message: "Student created successfully", student})

    } catch(err) {
        console.log(err);
        res.status(500).json({message: "Failed to create student"});
    }
})

export default router;