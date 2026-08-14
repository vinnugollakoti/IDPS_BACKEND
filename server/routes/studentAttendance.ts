import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isStaffRole } from "../middleware/auth";

const router = express.Router();
const dayStart = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const userId = (user: any) => Number(user?.userId ?? user?.id);

router.post("/batch-sync", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isStaffRole(req.user.role)) return res.status(403).json({ message: "Only school staff can record attendance" });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ message: "Nothing to sync", data: { synced: 0 } });
    const teacher = await prisma.teacher.findUnique({ where: { userId: userId(req.user) }, select: { id: true } });
    const codes: string[] = [...new Set<string>(items.map((item: any) => String(item?.studentCode || "").trim().toUpperCase()).filter(Boolean))];
    const students = await prisma.student.findMany({ where: { studentCode: { in: codes } }, select: { id: true, studentCode: true, classId: true } });
    const studentsByCode = new Map(students.map((student) => [student.studentCode?.toUpperCase(), student]));
    const grouped = new Map<string, { classId: number; date: Date; studentId: number; code: string }[]>();
    for (const item of items) {
      const code = String(item?.studentCode || "").trim().toUpperCase();
      const student = studentsByCode.get(code);
      if (!student) continue;
      const classId = Number(item?.classId || student.classId);
      if (classId !== student.classId) continue;
      const date = dayStart(item?.scannedAt);
      const key = `${classId}:${date.toISOString()}`;
      const group = grouped.get(key) || [];
      if (!group.some((entry) => entry.studentId === student.id)) group.push({ classId, date, studentId: student.id, code });
      grouped.set(key, group);
    }
    const syncedCodes: string[] = [];
    for (const group of grouped.values()) {
      const session = await prisma.attendanceSession.upsert({ where: { classId_date: { classId: group[0].classId, date: group[0].date } }, update: {}, create: { classId: group[0].classId, date: group[0].date, takenById: teacher?.id ?? null, createdAt: group[0].date } });
      await prisma.attendance.createMany({ data: group.map((entry) => ({ sessionId: session.id, studentId: entry.studentId, status: "PRESENT" as const })), skipDuplicates: true });
      await prisma.attendance.updateMany({ where: { sessionId: session.id, studentId: { in: group.map((entry) => entry.studentId) } }, data: { status: "PRESENT" } });
      syncedCodes.push(...group.map((entry) => entry.code));
    }
    const synced = syncedCodes.length;
    res.json({ message: "Attendance synced", data: { synced, syncedCodes, rejectedCodes: codes.filter((code) => !syncedCodes.includes(code)) } });
  } catch (error: any) {
    console.error("[Student Attendance Sync]", error?.message);
    res.status(500).json({ message: "Failed to sync student attendance", error: error?.message });
  }
});

router.get("/analytics", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isStaffRole(req.user.role)) return res.status(403).json({ message: "Only school staff can view attendance" });
    const date = dayStart(typeof req.query.date === "string" ? req.query.date : undefined);
    const classId = req.query.classId ? Number(req.query.classId) : null;
    const students = await prisma.student.findMany({ where: classId ? { classId } : {}, select: { id: true, name: true, studentCode: true, classId: true, class: { select: { name: true, section: true } } } });
    const sessions = await prisma.attendanceSession.findMany({ where: { date, ...(classId ? { classId } : {}) }, select: { attendances: { where: { status: "PRESENT" }, select: { studentId: true } } } });
    const presentIds = new Set(sessions.flatMap((session) => session.attendances.map((attendance) => attendance.studentId)));
    res.json({ message: "Attendance analytics fetched", data: { total: students.length, present: presentIds.size, absent: Math.max(0, students.length - presentIds.size), students: students.map((student) => ({ ...student, present: presentIds.has(student.id) })) } });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch attendance analytics", error: error?.message });
  }
});

export default router;
