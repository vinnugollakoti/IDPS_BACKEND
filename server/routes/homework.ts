import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { uploadHomeworkFile } from "../lib/supabaseStorage";
import { logAudit } from "../utils/audit";

const router = express.Router();
const resolveUserId = (user: any) => Number(user?.userId ?? user?.id) || null;
const canManage = (role: string) => isExecutiveRole(role) || role === "TEACHER";
const teacherForUser = async (userId: number | null) => userId ? prisma.teacher.findUnique({ where: { userId }, select: { id: true } }) : null;
const cleanOldHomework = async () => prisma.homework.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) } } });
const serialize = (item: any) => ({ ...item, attachments: Array.isArray(item.attachments) ? item.attachments : [] });

router.use(auth);

router.get("/classes", async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user.role)) return res.status(403).json({ message: "You are not allowed to view homework classes" });
    const classes = await prisma.class.findMany({ orderBy: [{ name: "asc" }, { section: "asc" }], select: { id: true, name: true, section: true, _count: { select: { students: true } } } });
    return res.json({ message: "Homework classes fetched successfully", data: classes });
  } catch (err: any) { return res.status(500).json({ message: err?.message || "Unable to fetch homework classes" }); }
});

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    await cleanOldHomework();
    const classId = req.query.classId ? Number(req.query.classId) : undefined;
    const userId = resolveUserId(req.user);
    const teacher = req.user.role === "TEACHER" ? await teacherForUser(userId) : null;
    let where: any = classId ? { classId } : {};
    if (teacher) where = { ...where, OR: [{ teacherId: teacher.id }, { class: { teachers: { some: { teacherId: teacher.id } } } }] };
    const homeworks = await prisma.homework.findMany({ where, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }] });
    const classIds = [...new Set(homeworks.map((item) => item.classId))];
    const teacherIds = [...new Set(homeworks.map((item) => item.teacherId))];
    const [classes, teachers] = await Promise.all([
      prisma.class.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true, section: true, _count: { select: { students: true } } } }),
      prisma.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true, photo: true } }),
    ]);
    const classMap = new Map(classes.map((item) => [item.id, item])); const teacherMap = new Map(teachers.map((item) => [item.id, item]));
    return res.json({ message: "Homework fetched successfully", data: homeworks.map((item) => serialize({ ...item, class: classMap.get(item.classId) || null, teacher: teacherMap.get(item.teacherId) || null })) });
  } catch (err: any) { console.error("GET /homework error:", err); return res.status(500).json({ message: err?.message || "Unable to fetch homework" }); }
});

router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user.role)) return res.status(403).json({ message: "You are not allowed to assign homework" });
    const { classId, subject, description, dueDate, attachments = [] } = req.body ?? {};
    if (!Number(classId) || !subject?.trim() || !description?.trim() || !dueDate || Number.isNaN(Date.parse(dueDate))) return res.status(400).json({ message: "Class, subject, instructions, and a valid due date are required" });
    const userId = resolveUserId(req.user); const teacher = req.user.role === "TEACHER" ? await teacherForUser(userId) : null;
    const teacherId = teacher?.id || Number(req.body.teacherId) || 1;
    const uploaded = [];
    for (const [index, file] of (Array.isArray(attachments) ? attachments : []).entries()) uploaded.push(await uploadHomeworkFile({ imageBase64: file.base64, imageMimeType: file.mimeType, path: `homework/${teacherId}_${Date.now()}_${index}` }));
    const result = await prisma.homework.create({ data: { classId: Number(classId), teacherId, subject: subject.trim(), description: description.trim(), dueDate: new Date(dueDate), attachments: uploaded } });
    await cleanOldHomework();
    void logAudit({ req, action: "CREATE_HOMEWORK", tag: "NOTICE" as any, details: `Assigned ${subject.trim()} homework to class ${classId}`, entityType: "Homework", entityId: result.id });
    return res.status(201).json({ message: "Homework assigned successfully", data: serialize(result) });
  } catch (err: any) { console.error("POST /homework error:", err); return res.status(500).json({ message: err?.message || "Unable to assign homework" }); }
});

router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user.role)) return res.status(403).json({ message: "You are not allowed to edit homework" });
    const id = Number(req.params.id); const existing = await prisma.homework.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Homework not found" });
    const teacher = req.user.role === "TEACHER" ? await teacherForUser(resolveUserId(req.user)) : null;
    if (teacher && existing.teacherId !== teacher.id) return res.status(403).json({ message: "Teachers can edit only their own homework" });
    const { classId, subject, description, dueDate } = req.body ?? {};
    const result = await prisma.homework.update({ where: { id }, data: { ...(classId ? { classId: Number(classId) } : {}), ...(subject?.trim() ? { subject: subject.trim() } : {}), ...(description?.trim() ? { description: description.trim() } : {}), ...(dueDate && !Number.isNaN(Date.parse(dueDate)) ? { dueDate: new Date(dueDate) } : {}) } });
    return res.json({ message: "Homework updated successfully", data: serialize(result) });
  } catch (err: any) { console.error("PUT /homework/:id error:", err); return res.status(500).json({ message: err?.message || "Unable to update homework" }); }
});

router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!canManage(req.user.role)) return res.status(403).json({ message: "You are not allowed to delete homework" });
    const id = Number(req.params.id); const existing = await prisma.homework.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Homework not found" });
    const teacher = req.user.role === "TEACHER" ? await teacherForUser(resolveUserId(req.user)) : null;
    if (teacher && existing.teacherId !== teacher.id) return res.status(403).json({ message: "Teachers can delete only their own homework" });
    await prisma.homework.delete({ where: { id } }); return res.json({ message: "Homework deleted successfully" });
  } catch (err: any) { return res.status(500).json({ message: err?.message || "Unable to delete homework" }); }
});

export default router;
