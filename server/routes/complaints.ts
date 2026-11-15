import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isStaffRole } from "../middleware/auth";
import { notifyStaff } from "./parent";

const router = express.Router();
const idOf = (user: any) => Number(user?.userId ?? user?.id);
const staff = (role: string) => ["TEACHER", "RECEPTIONIST", "PRINCIPAL", "DIRECTOR", "CHAIRMAN"].includes(role);

router.get("/", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!staff(req.user.role) && req.user.role !== "PARENT") return res.status(403).json({ message: "You are not allowed to view complaints" });
    const where: any = staff(req.user.role)
      ? { ...(req.query.status ? { status: String(req.query.status) as any } : {}) }
      : { submittedById: idOf(req.user), ...(req.query.studentId ? { studentId: Number(req.query.studentId) } : {}) };
    const complaints = await prisma.complaint.findMany({ where, include: { student: { select: { id: true, name: true, class: { select: { name: true, section: true } } } }, assignedTeacher: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ message: "Complaints fetched", data: complaints });
  } catch (error: any) { res.status(500).json({ message: "Failed to fetch complaints", error: error?.message }); }
});

router.post("/", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user.role !== "PARENT") return res.status(403).json({ message: "Only parents can submit complaints" });
    const body = req.body || {};
    const studentId = Number(body.studentId);
    const recipientType = body.recipientType === "CLASS_TEACHER" ? "CLASS_TEACHER" : body.recipientType === "PRINCIPAL" ? "PRINCIPAL" : null;
    const subject = String(body.subject || "").trim().slice(0, 160);
    const description = String(body.description || "").trim().slice(0, 5000);
    if (!subject || !description) return res.status(400).json({ message: "Subject and description are required" });
    if (!Number.isSafeInteger(studentId) || studentId < 1 || !recipientType) return res.status(400).json({ message: "Student and complaint recipient are required" });
    const parent = await prisma.parent.findUnique({ where: { userId: idOf(req.user) }, select: { id: true, name: true, phone1: true } });
    if (!parent) return res.status(403).json({ message: "Parent account was not found" });
    const linked = await prisma.parentStudent.findUnique({
      where: { parentId_studentId: { parentId: parent.id, studentId } },
      include: {
        student: {
          include: {
            class: {
              include: {
                teacher: { select: { id: true, userId: true } },
                teachers: { include: { teacher: { select: { id: true, userId: true } } } },
              },
            },
          },
        },
      },
    });
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const classTeacher = linked.student.class.teacher || linked.student.class.teachers[0]?.teacher;
    if (recipientType === "CLASS_TEACHER" && !classTeacher) return res.status(409).json({ message: "A class teacher is not assigned to this student yet" });
    const complaint = await prisma.complaint.create({ data: { mode: "OPEN", subject, description, category: String(body.category || "GENERAL").slice(0, 80), priority: "NORMAL", studentId, studentName: linked.student.name, studentCode: linked.student.studentCode, parentName: parent.name, parentPhone: parent.phone1, recipientType, assignedTeacherId: recipientType === "CLASS_TEACHER" ? classTeacher?.id : null, submittedById: idOf(req.user) } });
    const recipientUserIds = recipientType === "CLASS_TEACHER" && classTeacher
      ? [classTeacher.userId]
      : (await prisma.user.findMany({ where: { role: "PRINCIPAL" }, select: { id: true } })).map(user => user.id);
    void notifyStaff(recipientUserIds, "New parent message", "A parent has sent a message that needs your attention.").catch(error => console.warn("Could not notify complaint recipient", error?.message));
    res.status(201).json({ message: "Complaint submitted", data: complaint });
  } catch (error: any) { res.status(500).json({ message: "Failed to submit complaint", error: error?.message }); }
});

router.patch("/:id/status", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isStaffRole(req.user.role)) return res.status(403).json({ message: "Only staff can update complaints" });
    const status = ["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ message: "Invalid complaint status" });
    const complaint = await prisma.complaint.update({ where: { id: Number(req.params.id) }, data: { status, response: typeof req.body?.response === "string" ? req.body.response.trim() || null : undefined } });
    res.json({ message: "Complaint updated", data: complaint });
  } catch (error: any) { res.status(500).json({ message: "Failed to update complaint", error: error?.message }); }
});

export default router;
