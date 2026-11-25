import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole, isStaffRole } from "../middleware/auth";
import { serverCache } from "../utils/cache";
import { listPage, pageQuery, pageFilter, listRows } from "../utils/listPage";
const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};


router.get("/get-exams", auth, listPage("name", ["name", "examDate"]), async(req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(403).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let classIds: number[] | null = null;
        let parentStudentIds: number[] | null = null;
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched Exams", ...listRows([], res.locals.page)});
            const teacherClasses = await prisma.class.findMany({
                where: {
                    OR: [
                        { teacherId: teacher.id },
                        { teachers: { some: { teacherId: teacher.id } } }
                    ]
                },
                select: { id: true }
            });
            classIds = teacherClasses.map((c) => c.id);
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched Exams", ...listRows([], res.locals.page)});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched Exams", ...listRows([], res.locals.page)});
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            parentStudentIds = studentIds;
            if (studentIds.length === 0) return res.json({message: "Fetched Exams", ...listRows([], res.locals.page)});
            const parentClasses = await prisma.student.findMany({
                where: { id: { in: studentIds } },
                select: { classId: true }
            });
            classIds = Array.from(new Set(parentClasses.map((c) => c.classId)));
        }

        const exams = await prisma.exam.findMany({
            where: { AND: [classIds ? { classId: { in: classIds } } : {}, pageFilter(res.locals.page)] },
            include: {
                subject: true,
                class: true,
                marks: {
                    where: req.user.role === "PARENT" ? { studentId: { in: parentStudentIds || [] }, exam: { isReleased: true } } : undefined,
                    include: {
                        student: {
                            select: {
                                id: true,
                                name: true,
                                admissionno: true,
                                studentCode: true,
                                classId: true,
                            }
                        }
                    }
                }
            },
            ...pageQuery(res.locals.page)
        })

        res.json({message: "Fetched Exams", ...listRows(exams, res.locals.page)})

    } catch(err) {
        console.log(err)
        return res.status(500).json({message: "Error in fecthing the Exams"})
    }
})

router.get("/get-classes", auth, listPage("name", ["name", "section"]), async(req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(403).json({message : "UnAuthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: { OR?: Array<{ teacherId?: number; teachers?: { some: { teacherId: number } } }>; id?: { in: number[] } } = {};
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched classess successfully", ...listRows([], res.locals.page)});
            where = {
                OR: [
                    { teacherId: teacher.id },
                    { teachers: { some: { teacherId: teacher.id } } }
                ]
            };
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched classess successfully", ...listRows([], res.locals.page)});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched classess successfully", ...listRows([], res.locals.page)});
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            if (studentIds.length === 0) return res.json({message: "Fetched classess successfully", ...listRows([], res.locals.page)});
            const parentClasses = await prisma.student.findMany({
                where: { id: { in: studentIds } },
                select: { classId: true }
            });
            const classIds = Array.from(new Set(parentClasses.map((c) => c.classId)));
            where = { id: { in: classIds } };
        }

        const cacheKey = `get-classes:${req.user.role}:${authUserId}`;
        const cached = !res.locals.page && serverCache.get(cacheKey);
        if (cached) {
            return res.json({message: "Fetched classess successfully", data: cached});
        }

        const classes = await prisma.class.findMany({
            where: { AND: [where, pageFilter(res.locals.page)] },
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
                // Student records are loaded by /get-students. Keeping the
                // class response lightweight avoids returning every student
                // (and parent relation) twice on app startup.
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
            },
            ...pageQuery(res.locals.page)
        })

        if (!res.locals.page) serverCache.set(cacheKey, classes, 30);
        res.json({message: "Fetched classess successfully", ...listRows(classes, res.locals.page)})
    } catch(err) {
        console.log(err)
        return res.status(500).json({message: "Error in fetching the classes"});
    }
})

router.get("/get-teachers", auth, listPage("name", ["name"]), async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.json({ message: "Fetched teachers successfully", ...listRows([], res.locals.page) });
        }

        const teachers = await prisma.teacher.findMany({
            where: pageFilter(res.locals.page),
            include: {
                user: { select: { id: true, name: true, email: true, gender: true } },
                classes: { select: { id: true, name: true, section: true } },
                assignedClasses: { select: { class: { select: { id: true, name: true, section: true } } } },
                _count: { select: { assignedClasses: true, timetable: true } }
            },
            ...pageQuery(res.locals.page)
        })

        res.json({message: "Fetched teachers successfully", ...listRows(teachers, res.locals.page)})
    } catch(err) {
        console.log(err)
        return res.status(500).json({message: "Error in fetching the teachers, Contact developer"})
    }
})


router.get("/get-parents", auth, listPage("name", ["name"]), async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.json({ message: "Fetched parents successfully", ...listRows([], res.locals.page) });
        }

        const parents = await prisma.parent.findMany({
            where: pageFilter(res.locals.page),
            include: {
                user: true,
                students: {
                    include: {
                        student: true
                    }
                }
            },
            ...pageQuery(res.locals.page)
        })

        res.json({message: "Fetched parents successfully", ...listRows(parents, res.locals.page)})

    } catch(err) {
        console.log(err)
        return res.status(500).json({message: "Error in fecthing the parents, Contact developer"})
    }
})

router.get("/get-buses", auth, listPage("busNumber", ["busNumber", "routeName"]), async (req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role)) {
            return res.status(403).json({ message: "UnAuthorized request" });
        }
        const buses = await prisma.bus.findMany({
            where: pageFilter(res.locals.page),
            include: {
                _count: { select: { students: true } },
                driverUser: { select: { id: true, name: true, email: true, driver: { select: { id: true, phone: true, photo: true } } } }
            },
            orderBy: { id: "asc" },
            ...pageQuery(res.locals.page)
        });
        res.json({ message: "Fetched buses successfully", ...listRows(buses, res.locals.page) });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: "Error in fetching buses" });
    }
});

router.get("/get-marks", auth, listPage("examId", ["examId", "marks", "studentId"]), async(req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(403).json({message : "UnAuthorized request"});
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
            if (!teacher) return res.json({message: "Fetched marks successfully", ...listRows([], res.locals.page)});
            const teacherClasses = await prisma.class.findMany({
                where: { OR: [{ teacherId: teacher.id }, { teachers: { some: { teacherId: teacher.id } } }] },
                select: { id: true }
            });
            const classIds = teacherClasses.map((c) => c.id);
            where = { exam: { classId: { in: classIds } } };
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched marks successfully", ...listRows([], res.locals.page)});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched marks successfully", ...listRows([], res.locals.page)});
            where = {
                student: { parents: { some: { parentId: parent.id } } },
                exam: { isReleased: true }
            };
        }

        const marks = await prisma.mark.findMany({
            where: { AND: [where, pageFilter(res.locals.page)] },
            include : {
                student: req.user.role === "TEACHER"
                    ? { select: { id: true, name: true, studentCode: true, classId: true, class: { select: { id: true, name: true, section: true } } } }
                    : true,
                exam: true
            },
            ...pageQuery(res.locals.page)
        })
        
        res.json({message: "Fetched marks successfully", ...listRows(marks, res.locals.page)})
    } catch(err) {
        console.log(err)
        return res.status(500).json({message: "Error in fetching the marks"})
    }
})


router.get("/get-subjects", auth, listPage("name", ["name"]), async (req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(403).json({ message: "UnAuthorized request" });
        }

        const authUserId = resolveAuthUserId(req.user);

        let classIds: number[] | null = null;
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({message: "Fetched subjects successfully", ...listRows([], res.locals.page)});
            const teacherClasses = await prisma.class.findMany({
                where: { teacherId: teacher.id },
                select: { id: true }
            });
            classIds = teacherClasses.map((c) => c.id);
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched subjects successfully", ...listRows([], res.locals.page)});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched subjects successfully", ...listRows([], res.locals.page)});
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            if (studentIds.length === 0) return res.json({message: "Fetched subjects successfully", ...listRows([], res.locals.page)});
            const parentClasses = await prisma.student.findMany({
                where: { id: { in: studentIds } },
                select: { classId: true }
            });
            classIds = Array.from(new Set(parentClasses.map((c) => c.classId)));
        }

        const subjects = await prisma.subject.findMany({
            where: { AND: [classIds ? { classsubject: { some: { classId: { in: classIds } } } } : {}, pageFilter(res.locals.page)] },
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
            },
            ...pageQuery(res.locals.page)
        });

        res.json({
            message: "Fetched subjects successfully",
            ...listRows(subjects, res.locals.page)
        });

    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Error in fetching the subject"
        });
    }
});

router.get("/get-fees", auth, listPage("title", ["title", "createdAt", "total"]), async(req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(403).json({message : "UnAuthorized request"});
        }
        if (req.user.role === "TEACHER") {
            return res.status(403).json({message: "Teachers do not have access to fee records"});
        }

        const authUserId = resolveAuthUserId(req.user);

        // The relation filter also supports ClassTeacher assignments. Keep
        // this typed as an input object because Prisma's generated relation
        // type is not exported consistently across client versions.
        let where: any = {};

        if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({message: "Fetched fees successfully", ...listRows([], res.locals.page)});
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({message: "Fetched fees successfully", ...listRows([], res.locals.page)});
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

        const feeCacheKey = `get-fees:${req.user.role}:${authUserId}`;
        const cachedFees = !res.locals.page && serverCache.get(feeCacheKey);
        if (cachedFees) {
            return res.json({message: "Fetched fees successfully", data: cachedFees});
        }

        const fees = await prisma.fee.findMany({
            where: { AND: [where, pageFilter(res.locals.page)] },
            include: {
                student: {
                    include: {
                        class: true,
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
            },
            ...pageQuery(res.locals.page)
        });

        if (!res.locals.page) serverCache.set(feeCacheKey, fees, 30);
        return res.json({message: "Fetched fees successfully", ...listRows(fees, res.locals.page)});
    } catch(err) {
        console.log(err)
        return res.status(500).json({message: "Error in fetching the fees"});
    }
})

router.get("/get-students", auth, listPage("name", ["name", "studentCode"]), async (req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role) && req.user.role !== "PARENT") {
            return res.status(403).json({ message: "UnAuthorized request" });
        }

        const authUserId = resolveAuthUserId(req.user);

        let where: { classId?: { in: number[] }; id?: { in: number[] } } = {};
        // For TEACHER, track classIds in the cache key to prevent stale
        // empty-cache (from when teacher had no class) being served after assignment.
        let teacherClassIds: number[] = [];

        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) return res.json({ message: "Fetched students successfully", ...listRows([], res.locals.page) });

            const teacherClasses = await prisma.class.findMany({
                where: {
                    OR: [
                        { teacherId: teacher.id },
                        { teachers: { some: { teacherId: teacher.id } } }
                    ]
                },
                select: { id: true }
            });
            teacherClassIds = teacherClasses.map((c) => c.id).sort((a, b) => a - b);
            if (teacherClassIds.length === 0) return res.json({ message: "Fetched students successfully", ...listRows([], res.locals.page) });
            where = { classId: { in: teacherClassIds } };
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({ message: "Fetched students successfully", ...listRows([], res.locals.page) });
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({ message: "Fetched students successfully", ...listRows([], res.locals.page) });
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { studentId: true }
            });
            const studentIds = parentStudents.map((p) => p.studentId);
            if (studentIds.length === 0) return res.json({ message: "Fetched students successfully", ...listRows([], res.locals.page) });
            where = { id: { in: studentIds } };
        }

        // Include classIds in the cache key for TEACHER so that a change in
        // class assignment always results in a fresh fetch.
        const studentCacheKey = req.user.role === "TEACHER"
            ? `get-students:TEACHER:${authUserId}:${teacherClassIds.join(",")}`
            : `get-students:${req.user.role}:${authUserId}`;
        const cachedStudents = !res.locals.page && serverCache.get(studentCacheKey);
        if (cachedStudents) {
            return res.json({ message: "Fetched students successfully", data: cachedStudents });
        }

        const students = await prisma.student.findMany({
            where: { AND: [where, pageFilter(res.locals.page)] },
            include: {
                bus: true,
                class: {
                    select: {
                        id: true,
                        name: true,
                        section: true,
                        teacher: {
                            select: { id: true, name: true, phone: true, gender: true }
                        }
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
            },
            ...pageQuery(res.locals.page)
        });

        const safeStudents = req.user.role === "TEACHER"
            ? students.map((student: any) => {
                const { adharnumber: _studentAadhaar, ...safeStudent } = student;
                return {
                    ...safeStudent,
                    parents: Array.isArray(student.parents)
                        ? student.parents.map((link: any) => {
                            const { parent, ...safeLink } = link;
                            if (!parent) return safeLink;
                            const { adharnumber: _parentAadhaar, ...safeParent } = parent;
                            return { ...safeLink, parent: safeParent };
                        })
                        : [],
                };
            })
            : students;
        if (!res.locals.page) serverCache.set(studentCacheKey, safeStudents, 30);
        return res.json({ message: "Fetched students successfully", ...listRows(safeStudents, res.locals.page) });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: "Error in fetching students" });
    }
});

// PRINCIPAL ONLY: GET AUDIT LOGS WITH TAG & SEARCH FILTERS
router.get("/get-audit-logs", auth, async (req: AuthRequest, res: Response) => {
    try {
        let isExec = isExecutiveRole(req.user?.role);
        if (!isExec && (req.user?.userId || req.user?.id)) {
            const dbUser = await prisma.user.findUnique({
                where: { id: Number(req.user.userId || req.user.id) },
                select: { role: true },
            });
            if (dbUser && isExecutiveRole(dbUser.role)) {
                req.user.role = dbUser.role;
                isExec = true;
            }
        }
        if (!isExec) {
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
