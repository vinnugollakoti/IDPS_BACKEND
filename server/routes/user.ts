import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();

router.post("/create-parent", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
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

router.get("/me", auth, async (req: AuthRequest, res: Response) => {
   const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        parent: true,
        teacher: true
      }
   })

   res.json(user)
})


router.put("/update-parent/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "TEACHER" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "UnAuthorized request"})
        }

        const parentId = Number(req.params.id);

        const {name, email, gender, relation, phone1, phone2, village} = req.body;

        const parent = await prisma.parent.findUnique({
            where: {id: parentId}
        });

        if (!parent) {
            return res.status(400).json({message: "Parent profile not existed"});
        }

        const result = await prisma.$transaction(async (tx) => {
            if (email) {
                await tx.user.update({
                    where: {id: parent.userId},
                    data: {email, name, gender}
                })
            }

            const updatedParent = await tx.parent.update({
                where: {id: parentId},
                data: {
                    name,
                    relation,
                    phone1,
                    phone2,
                    village
                }
            })

            return updatedParent;
        })

        res.json({message: "Parent details updated successfully", data: result})

    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error in updating the details, Contact developer"})
    }
})


router.put("/update-student/:id", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "TEACHER" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "UnAuthorized request"})
        }

        const {photo, name, gender, dob, classId, busId} = req.body;
        const studentId = Number(req.params.id);

        const student = await prisma.student.update({
            where: {id: studentId},
            data: {
                photo,
                name,
                gender,
                dob,
                classId,
                busId
            },

            include: {
                parents: {include: {parent: true}},
                class: true,
                bus: true
            }
        })

        res.json({message: "Student details updated successfully", data: student});

    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error in updating student details, Contact developer"});
    }
})


router.put("/update-teacher/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "TEACHER" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "UnAuthorized request"})
        }

        const {name, email, phone, gender, salary} = req.body;

        const teacherId =  Number(req.params.id);

        const teacher = await prisma.teacher.findUnique({
            where: {id: teacherId}
        })

        if (!teacher) {
            return res.status(400).json({message: "Teacher not found"});
        }

        const result = await prisma.$transaction(async (tx) => {

            if(email || name) {
                await tx.user.update({
                    where: {id: teacher.id},
                    data: {
                        email,
                        name
                    }
                })
            }

            const updatedTeacher = tx.teacher.update({
                where: {id: teacherId},
                data: {
                    name,
                    email,
                    gender,
                    salary
                }
            })
            return updatedTeacher;
        })

        res.json({message: "Teacher details updated successfully", data: result})

    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Failed to update teacher details, Contact developer"});
    }
})



export default router;