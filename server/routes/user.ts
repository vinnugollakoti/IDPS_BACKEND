import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();

router.post("/create-parent", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized area"});
        }

        const {email, gender, name, relation, phone1, phone2, village} = req.body;

        if (!email || !name || !gender || !phone1) {
            return res.status(500).json({message: "Missing required fields"});
        }

        const existing = await prisma.user.findUnique({
            where: {email}
        });

        if (existing) {
            return res.status(400).json({message: "User already Existed"});
        }
        
        const result = await prisma.$transaction(async (tx) => {

            const user = await tx.user.create({
                data: {
                    name,
                    email,
                    role: "PARENT",
                    gender
                }
            })


            const parent = await tx.parent.create({
                data: {
                    name,
                    relation,
                    phone1,
                    phone2,
                    village,
                    userId: user.id
                }
            });

            return {user, parent};
        });

        res.json({message: "Parent created successfully", data: result} )
        
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Failed to create parent" });
    }
})

router.post("/create-teacher", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized area"});
        }
        
        const {name, email, phone, gender} = req.body;

        if (!name || !email || !phone || !gender) {
            return res.status(500).json({message : "Missing required fields"});
        }

        const existing = await prisma.user.findUnique({
            where : {email}
        })

        if (existing) {
            return res.status(400).json({message : "User is already existed"});
        }

        const result = await prisma.$transaction( async (tx) => {

            const user = await tx.user.create({
                data : {
                    name,
                    email,
                    role: "TEACHER",
                    gender
                }
            })

            const teacher = await tx.teacher.create({
                data : {
                    name,
                    phone,
                    gender,
                    userId: user.id
                }
            })

            return {user, teacher}
        });

        res.json({message : "Teacher created successfully", data: result})
    } catch(err) {
        console.log(err);
        res.status(500).json({message : "Failed to create teacher"})
    }
})




export default router;