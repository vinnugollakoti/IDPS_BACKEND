import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();


router.post("/create-class", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized area"});
        }

        const {name, section, teacherId} = req.body;

        if (!name || !section || !teacherId) {
            return res.status(500).json({message : "Missing required fields"});
        }

        const existingClass = await prisma.class.findUnique({
            where: {
                name_section: {
                name,
                section
                }
            }
        });

        if (existingClass) {
            return res.status(400).json({message: "Class already created"})
        }

        const result = await prisma.$transaction(async (tx) => {

            const teacher = await tx.class.create({
                data: {
                    name,
                    section,
                    teacherId
                }
            })

            return teacher;
        })

        res.json({message: "Class created successfully", data: result})
    } catch (err) {
        console.log(err)
        res.status(500).json({message: "Error creating class"})
    }
});


export default router;