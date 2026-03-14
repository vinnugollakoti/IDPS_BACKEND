import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();


router.post("/create-class", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
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


router.post("/create-subject", auth, async (req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST" && req.user.role !== "TEACHER") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const {name, classId} = req.body;

        if (!name || !classId) {
            return res.status(500).json({message: "You missed required inputs"});
        }

        let subject = await prisma.subject.findUnique({
            where: {name}
        })

        if (!subject) {
            subject = await prisma.subject.create ({
                data: { name }
            })
        }

        const existing = await prisma.classSubject.findUnique({
            where : {
                classId_subjectId: {
                    classId, 
                    subjectId: subject.id
                }
            }
        })

        if (existing) {
            return res.status(400).json({
                message: "Subject already existed and assigned to class"
            })
        }

        const classSubject = await prisma.classSubject.create({
            data: {
                classId,
                subjectId: subject.id
            },

            include: {
                class: true,
                subject: true
            }
        });

        res.json({message: "Subject created successfully", data: classSubject})

    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Failed to create subject."})
    }
})


router.post("/create-exam", auth, async(req: AuthRequest, res: Response) => {

    try {

        if (req.user.role !== 'TEACHER' && req.user.role !== 'PRINCIPAL' && req.user.role !== 'RECEPTIONIST') {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const {exam_name, totalMarks, subjectId, examDate, classId} = req.body;

        if (!exam_name || !totalMarks || !subjectId || !examDate || !classId) {
            return res.status(500).json({message : "Missing required fields"});
        }

        const existedExam = await prisma.exam.findUnique({
            where: {
                name_subjectId_classId: {
                    name: exam_name,
                    subjectId,
                    classId
                }
            }
        })

        if (existedExam) {
            return res.status(600).json({message: "Exam already existed try searching your exam."})
        }

        const result = await prisma.$transaction( async(tx) => {

            const exam = tx.exam.create({
                data: {
                    name: exam_name,
                    totalMarks,
                    subjectId,
                    examDate,
                    classId,  
                },

                include: {
                    subject: true,
                    class: true
                }
            })

            return exam;
        })

        res.json({message: "Exam created successfully", data: result})


    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in creating the class"});
    }

})


router.post("/create-marks", auth, async(req: AuthRequest, res: Response) => {
    try { 
        if (req.user.role !== "TEACHER" && req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "Unauthorized request"})
        }

        const {examId, marks, studentId} = req.body;

        if (!examId || !marks || !studentId) {
            return res.status(500).json({message: "Missing required fields"});
        }

        const result = await prisma.mark.upsert({
            where: {
                examId_studentId: {
                    examId,
                    studentId
                }
            },
            update: {
                marks
            },
            create: {
                examId,
                marks,
                studentId
            }
        })


        res.json({message: "Marks Created/Updated successfully!", data: result })
    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error creating marks details"});
    }
})




export default router;