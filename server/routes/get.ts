import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};


router.get("/get-exams", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (
            req.user.role !== "PRINCIPAL" &&
            req.user.role !== "RECEPTIONIST" &&
            req.user.role !== "TEACHER" &&
            req.user.role !== "PARENT"
        ) {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let classIds: number[] | null = null;
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched Exams", data: []});
            const teacherClasses = await prisma.class.findMany({
                where: { teacherId: teacher.id },
                select: { id: true }
            });
            classIds = teacherClasses.map((c) => c.id);
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched Exams", data: []});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched Exams", data: []});
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            if (studentIds.length === 0) return res.json({message: "Fetched Exams", data: []});
            const parentClasses = await prisma.student.findMany({
                where: { id: { in: studentIds } },
                select: { classId: true }
            });
            classIds = Array.from(new Set(parentClasses.map((c) => c.classId)));
        }

        const exams = await prisma.exam.findMany({
            where: classIds ? { classId: { in: classIds } } : undefined,
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
        if (
            req.user.role !== "PRINCIPAL" &&
            req.user.role !== "RECEPTIONIST" &&
            req.user.role !== "TEACHER" &&
            req.user.role !== "PARENT"
        ) {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: { id?: { in: number[] }; teacherId?: number } = {};
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched classess successfully", data: []});
            where = { teacherId: teacher.id };
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched classess successfully", data: []});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched classess successfully", data: []});
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            if (studentIds.length === 0) return res.json({message: "Fetched classess successfully", data: []});
            const parentClasses = await prisma.student.findMany({
                where: { id: { in: studentIds } },
                select: { classId: true }
            });
            const classIds = Array.from(new Set(parentClasses.map((c) => c.classId)));
            where = { id: { in: classIds } };
        }

        const classes = await prisma.class.findMany({
            where,
            include: {
                teacher: true,
                students: {
                    select: {
                        id: true,
                        name: true,
                        admissionno: true,
                        parents: {
                            include: {
                                parent: {
                                    select: {
                                        id: true,
                                        name: true,
                                        relation: true,
                                        type: true,
                                        phone1: true,
                                        phone2: true,
                                    }
                                }
                            }
                        }
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
        return res.status(400).json({message: "Error in fetching the teachers, Contact developer"})
    }
})


router.get("/get-parents", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const parents = await prisma.parent.findMany({
            include: {
                user: true,
                students: {
                    include: {
                        student: true
                    }
                }
            }
        })

        res.json({message: "Fetched parents successfully", data: parents})

    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fecthing the parents, Contact developer"})
    }
})

router.get("/get-marks", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (
            req.user.role !== "PRINCIPAL" &&
            req.user.role !== "RECEPTIONIST" &&
            req.user.role !== "TEACHER" &&
            req.user.role !== "PARENT"
        ) {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: {
            exam?: { classId?: { in: number[] } };
            student?: { parents?: { some?: { parentId?: number } } };
        } = {};

        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched marks successfully", data: []});
            const teacherClasses = await prisma.class.findMany({
                where: { teacherId: teacher.id },
                select: { id: true }
            });
            const classIds = teacherClasses.map((c) => c.id);
            where = { exam: { classId: { in: classIds } } };
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched marks successfully", data: []});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched marks successfully", data: []});
            where = { student: { parents: { some: { parentId: parent.id } } } };
        }

        const marks = await prisma.mark.findMany({
            where,
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


router.get("/get-subjects", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (
            req.user.role !== "PRINCIPAL" &&
            req.user.role !== "RECEPTIONIST" &&
            req.user.role !== "TEACHER" &&
            req.user.role !== "PARENT"
        ) {
            return res.status(400).json({ message: "UnAuthorized request" });
        }

        const authUserId = resolveAuthUserId(req.user);

        let classIds: number[] | null = null;
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched subjects successfully", data: []});
            const teacherClasses = await prisma.class.findMany({
                where: { teacherId: teacher.id },
                select: { id: true }
            });
            classIds = teacherClasses.map((c) => c.id);
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched subjects successfully", data: []});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched subjects successfully", data: []});
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            if (studentIds.length === 0) return res.json({message: "Fetched subjects successfully", data: []});
            const parentClasses = await prisma.student.findMany({
                where: { id: { in: studentIds } },
                select: { classId: true }
            });
            classIds = Array.from(new Set(parentClasses.map((c) => c.classId)));
        }

        const subjects = await prisma.subject.findMany({
            where: classIds ? { classsubject: { some: { classId: { in: classIds } } } } : undefined,
            include: {
                exams: {
                    select: {
                        id: true,
                        name: true,
                        subject: true // ✅ move inside select
                    }
                },
                classsubject: {
                    where: classIds ? { classId: { in: classIds } } : undefined,
                    include: {
                        class: true,
                        subject: true
                    }
                }
            }
        });

        res.json({
            message: "Fetched subjects successfully",
            data: subjects
        });

    } catch (err) {
        console.log(err);
        return res.status(400).json({
            message: "Error in fetching the subject"
        });
    }
});

router.get("/get-fees", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (
            req.user.role !== "PRINCIPAL" &&
            req.user.role !== "RECEPTIONIST" &&
            req.user.role !== "TEACHER" &&
            req.user.role !== "PARENT"
        ) {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: {
            student?: {
                class?: { teacherId?: number };
                parents?: { some?: { parentId?: number } };
            }
        } = {};

        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched fees successfully", data: []});
            where = {
                student: {
                    class: {
                        teacherId: teacher.id
                    }
                }
            };
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched fees successfully", data: []});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched fees successfully", data: []});
            where = {
                student: {
                    parents: {
                        some: {
                            parentId: parent.id
                        }
                    }
                }
            };
        }

        const fees = await prisma.fee.findMany({
            where,
            include: {
                student: {
                    include: {
                        class: true,
                        parents: {
                            include: {
                                parent: true
                            }
                        }
                    }
                },
                payments: {
                    include: {
                        verifiedBy: true
                    },
                    orderBy: {
                        createdAt: "desc"
                    }
                }
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        return res.json({message: "Fetched fees successfully", data: fees});
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fetching the fees"});
    }
})


export default router;
