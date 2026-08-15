import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isStaffRole } from "../middleware/auth";

const router = express.Router();
const idOf = (user: any) => Number(user?.userId ?? user?.id);
const staff = (role: string) => ["TEACHER", "RECEPTIONIST", "PRINCIPAL", "DIRECTOR", "CHAIRMAN"].includes(role);

router.get("/", auth, async (req: AuthRequest, res: Response) => {
  try {
    const where = staff(req.user.role) ? (req.query.status ? { status: String(req.query.status) as any } : {}) : { submittedById: idOf(req.user) };
    const complaints = await prisma.complaint.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ message: "Complaints fetched", data: complaints });
  } catch (error: any) { res.status(500).json({ message: "Failed to fetch complaints", error: error?.message }); }
});

router.post("/", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user.role !== "PARENT") return res.status(403).json({ message: "Only parents can submit complaints" });
    const body = req.body || {};
    const mode = body.mode === "ANONYMOUS" ? "ANONYMOUS" : "OPEN";
    const subject = String(body.subject || "").trim();
    const description = String(body.description || "").trim();
    if (!subject || !description) return res.status(400).json({ message: "Subject and description are required" });
    const complaint = await prisma.complaint.create({ data: { mode, subject, description, category: body.category || null, priority: ["HIGH", "URGENT"].includes(body.priority) ? body.priority : "NORMAL", ...(mode === "OPEN" ? { studentName: body.studentName || null, studentCode: body.studentCode || null, parentName: body.parentName || null, parentPhone: body.parentPhone || null } : {}), submittedById: idOf(req.user) } });
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
