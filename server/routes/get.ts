import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();


router.get("/get-exams", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const exams = await prisma.exam.findMany({
            include: {
                subject: true,
                class: true,
                marks: {
                    include: {
                        student: true,
                        exam: true
                    }
                }
            }
        })

        res.json({message: "Fetched Exams", data: exams})

    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fecthing the Exams"})
    }
})

router.get("/get-classes", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const classes = await prisma.class.findMany({
            include: {
                teacher: true,
                students: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                timetable: {
                    include: {
                        teacher: true
                    }
                },
                attendanceSessions: {
                    include: {
                        attendances: true,
                        takenBy: true
                    }
                }
            }
        })

        res.json({message: "Fetched classess successfully", data: classes})
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fetching the classes"});
    }
})

router.get("/get-teachers", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const teachers = await prisma.teacher.findMany({
            include: {
                user: true,
                classes: true,
                timetable: true
            }
        })

        res.json({message: "Fetched teachers successfully", data: teachers})
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fetching the teachers"})
    }
})

router.get("/get-marks", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const marks = await prisma.mark.findMany({
            include : {
                student: true,
                exam: true
            }
        })
        
        res.json({message: "Fetched marks successfully", data: marks})
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fetching the marks"})
    }
})


router.get("/get-subjects", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const subjects = await prisma.subject.findMany({
            include: {
                exams: {
                    select: {
                        id: true,
                        name: true
                    },
                    include : {
                        subject: true
                    }
                },
                classsubject: {
                    include: {
                        class: true,
                        subject: true
                    }
                }
            }
        })

        res.json({message: "Fetched subjects successfully", data: subjects})
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fetching the subject"})
    }
})


export default router;