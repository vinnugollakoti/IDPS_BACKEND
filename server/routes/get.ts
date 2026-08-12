import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole, isStaffRole } from "../middleware/auth";
import { serverCache } from "../utils/cache";
const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};


router.get("/get-exams", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(401).json({message : "UnAuthorized request"});
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
                        student: {
                            select: {
                                id: true,
                                name: true,
                                admissionno: true,
                                classId: true,
                            }
                        }
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
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(401).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: { OR?: Array<{ teacherId?: number; teachers?: { some: { teacherId: number } } }>; id?: { in: number[] } } = {};
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched classess successfully", data: []});
            where = {
                OR: [
                    { teacherId: teacher.id },
                    { teachers: { some: { teacherId: teacher.id } } }
                ]
            };
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

        const cacheKey = `get-classes:${req.user.role}:${req.user.id}`;
        const cached = serverCache.get(cacheKey);
        if (cached) {
            return res.json({message: "Fetched classess successfully", data: cached});
        }

        const classes = await prisma.class.findMany({
            where,
            include: {
                teacher: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        gender: true,
                    }
                },
                teachers: {
                    include: {
                        teacher: {
                            select: {
                                id: true,
                                name: true,
                                phone: true,
                                gender: true,
                            }
                        }
                    }
                },
                students: {
                    select: {
                        id: true,
                        name: true,
                        admissionno: true,
                        gender: true,
                        dob: true,
                        adharnumber: true,
                        pincode: true,
                        mothertongue: true,
                        socialcategory: true,
                        bloodgroup: true,
                        admissiondate: true,
                        height: true,
                        weight: true,
                        address: true,
                        parents: {
                            select: {
                                parent: {
                                    select: {
                                        id: true,
                                        name: true,
                                        relation: true,
                                        type: true,
                                        phone1: true,
                                        phone2: true,
                                        adharnumber: true,
                                        qualification: true,
                                        user: {
                                            select: {
                                                email: true,
                                                gender: true,
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                timetable: {
                    include: {
                        teacher: {
                            select: {
                                id: true,
                                name: true,
                                phone: true,
                            }
                        }
                    }
                },
                attendanceSessions: {
                    take: 10,
                    orderBy: {
                        date: "desc"
                    },
                    include: {
                        attendances: true,
                        takenBy: {
                            select: {
                                id: true,
                                name: true,
                            }
                        }
                    }
                }
            }
        })

        serverCache.set(cacheKey, classes, 60);
        res.json({message: "Fetched classess successfully", data: classes})
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fetching the classes"});
    }
})

router.get("/get-teachers", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
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
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
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
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(401).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: {
            exam?: { classId?: { in: number[] }; isReleased?: boolean };
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
            where = {
                student: { parents: { some: { parentId: parent.id } } },
                exam: { isReleased: true }
            };
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
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(401).json({ message: "UnAuthorized request" });
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
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(401).json({message : "UnAuthorized request"});
        }

        const feeCacheKey = `get-fees:${req.user.role}:${req.user.id}`;
        const cachedFees = serverCache.get(feeCacheKey);
        if (cachedFees) {
            return res.json({message: "Fetched fees successfully", data: cachedFees});
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

        serverCache.set(feeCacheKey, fees, 60);
        return res.json({message: "Fetched fees successfully", data: fees});
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in fetching the fees"});
    }
})

router.get("/get-students", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(401).json({ message: "UnAuthorized request" });
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: { classId?: { in: number[] }; id?: { in: number[] } } = {};

        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({ message: "Fetched students successfully", data: [] });

            const teacherClasses = await prisma.class.findMany({
                where: {
                    OR: [
                        { teacherId: teacher.id },
                        { teachers: { some: { teacherId: teacher.id } } }
                    ]
                },
                select: { id: true }
            });
            const classIds = teacherClasses.map((c) => c.id);
            if (classIds.length === 0) return res.json({ message: "Fetched students successfully", data: [] });
            where = { classId: { in: classIds } };
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({ message: "Fetched students successfully", data: [] });
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({ message: "Fetched students successfully", data: [] });
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            if (studentIds.length === 0) return res.json({ message: "Fetched students successfully", data: [] });
            where = { id: { in: studentIds } };
        }

        const studentCacheKey = `get-students:${req.user.role}:${req.user.id}`;
        const cachedStudents = serverCache.get(studentCacheKey);
        if (cachedStudents) {
            return res.json({ message: "Fetched students successfully", data: cachedStudents });
        }

        const students = await prisma.student.findMany({
            where,
            include: {
                class: {
                    include: {
                        teacher: true
                    }
                },
                parents: {
                    include: {
                        parent: {
                            include: {
                                user: {
                                    select: {
                                        email: true,
                                        gender: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                name: "asc"
            }
        });

        serverCache.set(studentCacheKey, students, 60);
        return res.json({ message: "Fetched students successfully", data: students });
    } catch (err) {
        console.log(err);
        return res.status(400).json({ message: "Error in fetching students" });
    }
});

// PRINCIPAL ONLY: GET AUDIT LOGS WITH TAG & SEARCH FILTERS
router.get("/get-audit-logs", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role)) {
            return res.status(403).json({ message: "Unauthorized request. Only Executive leadership (Principal, Director, Chairman) can view system audit logs." });
        }

        const { tag, action, performedById, role, search, page = "1", limit = "50" } = req.query;

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
        const skip = (pageNum - 1) * limitNum;

        const whereClause: any = {};

        if (tag && typeof tag === "string" && tag.trim()) {
            whereClause.tag = tag.trim().toUpperCase();
        }

        if (action && typeof action === "string" && action.trim()) {
            whereClause.action = action.trim().toUpperCase();
        }

        if (performedById) {
            whereClause.performedById = Number(performedById);
        }

        if (role && typeof role === "string" && role.trim()) {
            whereClause.performedByRole = role.trim().toUpperCase();
        }

        if (search && typeof search === "string" && search.trim()) {
            const query = search.trim();
            whereClause.OR = [
                { details: { contains: query, mode: "insensitive" } },
                { action: { contains: query, mode: "insensitive" } },
                { performedBy: { name: { contains: query, mode: "insensitive" } } },
            ];
        }

        const [totalCount, logs] = await Promise.all([
            prisma.auditLog.count({ where: whereClause }),
            prisma.auditLog.findMany({
                where: whereClause,
                include: {
                    performedBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true,
                            gender: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: "desc",
                },
                skip,
                take: limitNum,
            }),
        ]);

        return res.json({
            message: "Fetched audit logs successfully",
            pagination: {
                total: totalCount,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(totalCount / limitNum),
            },
            data: logs,
        });
    } catch (err) {
        console.error("Error fetching audit logs:", err);
        return res.status(500).json({ message: "Error fetching audit logs" });
    }
});

export default router;
