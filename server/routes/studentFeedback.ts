import express from "express";
import prisma from "../prisma/client";
import { auth, AuthRequest } from "../middleware/auth";

const router = express.Router();
const select = { id: true, authorName: true, message: true, createdAt: true } as const;
const positiveId = (value: unknown) => typeof value === "string" && /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647 ? Number(value) : null;

router.post("/:studentId", auth, async (req: AuthRequest, res) => {
  if (req.user.role !== "TEACHER") return res.sendStatus(403);
  const studentId = positiveId(req.params.studentId);
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!studentId || !message || message.length > 2000) return res.status(400).json({ message: "Enter a note of 1–2,000 characters for a valid student." });
  const userId = Number(req.user.userId);
  // Check assignment and insert in one statement, including secondary teachers.
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO "StudentFeedback" ("studentId","authorId","authorName","message")
    SELECT s.id, u.id, t.name, ${message} FROM "Student" s
    JOIN "Class" c ON c.id = s."classId"
    JOIN "Teacher" t ON t."userId" = ${userId}
    JOIN "User" u ON u.id = t."userId" AND u.role = 'TEACHER'
    WHERE s.id = ${studentId} AND (c."teacherId" = t.id OR EXISTS (
      SELECT 1 FROM "ClassTeacher" ct WHERE ct."classId" = c.id AND ct."teacherId" = t.id
    )) RETURNING id`;
  if (!rows.length) return res.status(403).json({ message: "This student is not in your assigned classes." });
  return res.status(201).json({ data: rows[0] });
});

router.get("/:studentId", auth, async (req: AuthRequest, res) => {
  if (req.user.role !== "PARENT") return res.sendStatus(403);
  const studentId = positiveId(req.params.studentId);
  const before = positiveId(req.query.before);
  if (!studentId || (req.query.before !== undefined && !before)) return res.sendStatus(400);
  const student = await prisma.student.findFirst({
    where: { id: studentId, parents: { some: { parent: { userId: Number(req.user.userId) } } } },
    select: { teacherNotes: { select, where: before ? { id: { lt: before } } : {}, orderBy: { id: "desc" }, take: 21 } },
  });
  if (!student) return res.status(403).json({ message: "Student unavailable." });
  const notes = student.teacherNotes.slice(0, 20);
  return res.json({ data: notes, next: student.teacherNotes.length > 20 ? notes[19].id : null });
});

export default router;
