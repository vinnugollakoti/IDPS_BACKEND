import { storedReportCards } from "../utils/storedReportCards";
import { reportCardDocument } from "../utils/reportCardDocument";
import express, { Response } from "express";
import prisma from "../prisma/client";
import { auth, AuthRequest, isExecutiveRole } from "../middleware/auth";

const router = express.Router();
router.use(auth);
router.route("/:examId/:studentId").all(async (req: AuthRequest, res: Response) => {
  const studentId = Number(req.params.studentId);
  const examId = Number(req.params.examId);
  if (!["GET", "PUT"].includes(req.method)) return res.sendStatus(405);
  if (![examId, studentId].every(id => Number.isSafeInteger(id) && id > 0)) return res.sendStatus(400);
  try {
    const userId = Number(req.user.userId ?? req.user.id);
    const scope = isExecutiveRole(req.user.role) ? {} : {
      OR: [{ teacher: { userId } }, { teachers: { some: { teacher: { userId } } } }]
    };
    if (!isExecutiveRole(req.user.role) && req.user.role !== "TEACHER") return res.sendStatus(403);
    const exam = await prisma.exam.findFirst({ where: { id: examId, class: { ...scope, students: { some: { id: studentId } } } } });
    if (!exam) return res.sendStatus(404);
    const exams = await prisma.exam.findMany({ where: { name: exam.name, classId: exam.classId }, orderBy: { id: "asc" }, include: { subject: true, marks: { where: { studentId } } } });
    const key = { examId: exams[0].id, studentId };
    if (req.method === "GET") {
      const [card] = await storedReportCards(studentId,[key.examId]);
      const student = await prisma.student.findUniqueOrThrow({where:{id:studentId},include:{class:true}});
      return res.set("Cache-Control","private, no-store").json({ html: reportCardDocument(student,exam.name,exams[0].examDate,exams,card?.fields), fields: card?.fields ?? {}, revision: card?.revision ?? 0, exams: exams.map(e => ({name: e.subject.name, max: e.totalMarks, mark: e.marks[0]?.marks ?? null})) });
    }
    const { fields, revision } = req.body ?? {};
    if (!Number.isSafeInteger(revision) || revision < 0 || !fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).length > 100 ||
        Object.entries(fields).some(([k,v]) => !/^[a-zA-Z0-9 .-]{1,60}$/.test(k) || typeof v !== "string" || v.length > 1000))
      return res.status(400).json({message:"Invalid report card fields"});
    for (const [key, value] of Object.entries(fields) as [string,string][]) {
      if (!value.trim()) continue;
      if (/ (PA|MA|Portfolio|SEA|Written)$/.test(key)) {
        const written = key.endsWith(" Written");
        if (written && /^abs$/i.test(value)) continue;
        if (!Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>(written?80:5))
          return res.status(400).json({message:"Assessment mark is outside its range"});
      }
      if (["Working days","Days attended"].includes(key) && !/^\d{1,3}$/.test(value)) return res.status(400).json({message:"Enter whole attendance days"});
      if (["Art education","Health and physical education","Discipline","Activity 1 grade","Activity 2 grade"].includes(key) && !/^[A-E]$/i.test(value)) return res.status(400).json({message:"Enter an activity grade from A to E"});
    }
    if (fields["Working days"] && Number(fields["Days attended"])>Number(fields["Working days"])) return res.status(400).json({message:"Days attended exceeds working days"});
    if (revision === 0) await prisma.reportCard.create({data:{...key, fields}});
    else {
      const result = await prisma.reportCard.updateMany({ where:{...key, revision}, data:{ fields, revision:{increment:1} } });
      if (!result.count) return res.status(409).json({message:"Another teacher saved this card. Reopen it before editing."});
    }
    return res.json({revision:revision+1});
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({message:"Report changed. Reopen it before editing."});
    return res.status(500).json({message:"Could not access report card"});
  }
});
export default router;
