import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { logAudit } from "../utils/audit";

const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};

// GET /homework - Fetch homework list (Filtered by classId if provided)
router.get("/", auth, async (req: AuthRequest, res: Response) => {
    try {
        const { classId } = req.query;
        const authUserId = resolveAuthUserId(req.user);

        let whereClause: any = {};

        if (classId) {
            whereClause.classId = Number(classId);
        } else if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (teacher) {
                const assigned = await prisma.classTeacher.findMany({
                    where: { teacherId: teacher.id },
                    select: { classId: true }
                });
                const teacherClassIds = assigned.map((ct) => ct.classId);
                const ownClasses = await prisma.class.findMany({
                    where: { teacherId: teacher.id },
                    select: { id: true }
                });
                const allIds = Array.from(new Set([...teacherClassIds, ...ownClasses.map(c => c.id)]));
                whereClause.classId = { in: allIds };
            }
        } else if (req.user.role === "PARENT") {
            if (!authUserId) return res.json({ message: "Fetched homeworks", data: [] });
            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!parent) return res.json({ message: "Fetched homeworks", data: [] });
            const parentStudents = await prisma.parentStudent.findMany({
                where: { parentId: parent.id },
                select: { student: { select: { classId: true } } }
            });
            const studentClassIds = parentStudents.map((ps) => ps.student.classId);
            whereClause.classId = { in: Array.from(new Set(studentClassIds)) };
        }

        const homeworks = await prisma.homework.findMany({
            where: whereClause,
            orderBy: { dueDate: "desc" }
        });

        // Enrich homework entries with class and teacher info
        const classIds = Array.from(new Set(homeworks.map(h => h.classId)));
        const teacherIds = Array.from(new Set(homeworks.map(h => h.teacherId)));

        const [classes, teachers] = await Promise.all([
            prisma.class.findMany({
                where: { id: { in: classIds } },
                select: { id: true, name: true, section: true }
            }),
            prisma.teacher.findMany({
                where: { id: { in: teacherIds } },
                select: { id: true, name: true }
            })
        ]);

        const classMap = new Map(classes.map(c => [c.id, c]));
        const teacherMap = new Map(teachers.map(t => [t.id, t]));

        const enriched = homeworks.map(h => ({
            ...h,
            class: classMap.get(h.classId) || null,
            teacher: teacherMap.get(h.teacherId) || null,
        }));

        return res.json({ message: "Fetched homeworks successfully", data: enriched });
    } catch (err: any) {
        console.error("GET /homework error:", err);
        return res.status(500).json({ message: err?.message || "Internal server error" });
    }
});

// POST /homework - Create a new homework assignment
router.post("/", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "TEACHER" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized to assign homework" });
        }

        const { classId, subject, description, dueDate } = req.body;

        if (!classId || !subject || !description || !dueDate) {
            return res.status(400).json({ message: "classId, subject, description, and dueDate are required" });
        }

        const authUserId = resolveAuthUserId(req.user);
        let teacherId = 1;

        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (teacher) teacherId = teacher.id;
        }

        const newHomework = await prisma.homework.create({
            data: {
                classId: Number(classId),
                teacherId,
                subject: String(subject).trim(),
                description: String(description).trim(),
                dueDate: new Date(dueDate),
            }
        });

        await logAudit({
            req,
            action: "CREATE_HOMEWORK",
            tag: "NOTICE" as any,
            details: `Created homework for subject "${subject}" in class ID ${classId}`,
            entityType: "Homework",
            entityId: newHomework.id.toString(),
        });

        return res.status(201).json({ message: "Homework created successfully", data: newHomework });
    } catch (err: any) {
        console.error("POST /homework error:", err);
        return res.status(500).json({ message: err?.message || "Failed to create homework" });
    }
});

// DELETE /homework/:id - Delete a homework task
router.delete("/:id", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "TEACHER") {
            return res.status(403).json({ message: "Unauthorized to delete homework" });
        }

        const id = Number(req.params.id);
        const existing = await prisma.homework.findUnique({ where: { id } });

        if (!existing) {
            return res.status(404).json({ message: "Homework assignment not found" });
        }

        await prisma.homework.delete({ where: { id } });

        const authUserId = resolveAuthUserId(req.user);
        await logAudit({
            req,
            action: "DELETE_HOMEWORK",
            tag: "NOTICE" as any,
            details: `Deleted homework assignment ID ${id} (${existing.subject})`,
            entityType: "Homework",
            entityId: id.toString(),
        });

        return res.json({ message: "Homework deleted successfully" });
    } catch (err: any) {
        console.error("DELETE /homework/:id error:", err);
        return res.status(500).json({ message: err?.message || "Failed to delete homework" });
    }
});

export default router;
