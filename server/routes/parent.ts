import express, { Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import webpush, { PushSubscription } from "web-push";
import { isBusTripWindowOpen } from "../utils/busTripSchedule";

const router = express.Router();
router.use(auth);
const userIdOf = (req: AuthRequest) => Number(req.user?.userId ?? req.user?.id);
const isParent = (req: AuthRequest) => req.user?.role === "PARENT";
const safeDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const schoolDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export async function notifyStaff(userIds: number[], title: string, body: string) {
  if (!userIds.length) return;
  const tokens = await prisma.pushToken.findMany({ where: { userId: { in: userIds } }, select: { token: true, platform: true } });
  const mobileMessages = tokens.filter(item => item.platform !== "web").map(item => ({ to: item.token, sound: "default", title, body, channelId: "default", priority: "high", data: { type: "parent-update" } }));
  if (mobileMessages.length) {
    void fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(mobileMessages) }).catch(error => console.warn("Parent update push delivery failed", error?.message));
  }
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY; const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const webTargets = tokens.filter(item => item.platform === "web");
  if (publicKey && privateKey && webTargets.length) {
    webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT ?? "mailto:chairman@idps.com", publicKey, privateKey);
    const payload = JSON.stringify({ title, body, url: "/" });
    await Promise.all(webTargets.map(item => webpush.sendNotification(JSON.parse(item.token) as PushSubscription, payload, { TTL: 86400 }).catch(error => console.warn("Parent update web push delivery failed", error?.message))));
  }
}

async function getParent(req: AuthRequest) {
  if (!isParent(req)) return null;
  const id = userIdOf(req);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return prisma.parent.findUnique({ where: { userId: id }, select: { id: true, name: true, phone1: true, userId: true } });
}

async function getLinkedStudent(req: AuthRequest, studentId: number) {
  const parent = await getParent(req);
  if (!parent) return null;
  const link = await prisma.parentStudent.findUnique({ where: { parentId_studentId: { parentId: parent.id, studentId } }, select: { studentId: true } });
  if (!link) return null;
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      class: {
        include: {
          teacher: { select: { id: true, name: true, phone: true, userId: true } },
          teachers: { include: { teacher: { select: { id: true, name: true, phone: true, userId: true } } } },
        },
      },
      bus: true,
    },
  });
  return student ? { parent, student } : null;
}

router.get("/students", async (req: AuthRequest, res: Response) => {
  try {
    const parent = await getParent(req);
    if (!parent) return res.status(403).json({ message: "Only parent accounts can view linked students" });
    const links = await prisma.parentStudent.findMany({ where: { parentId: parent.id }, include: { student: { include: { class: true } } }, orderBy: { studentId: "asc" } });
    return res.json({ message: "Linked students fetched", students: links.map(({ student }) => ({ id: student.id, name: student.name, avatarUrl: student.photo, className: student.class.name, classId: student.classId, section: student.class.section })) });
  } catch (error) { console.error("GET /parent/students", error); return res.status(500).json({ message: "Could not fetch linked students" }); }
});

router.get("/students/:studentId/profile", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const linked = await getLinkedStudent(req, studentId);
    if (!Number.isSafeInteger(studentId) || studentId < 1) return res.status(400).json({ message: "Invalid student id" });
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const parentLinks = await prisma.parentStudent.findMany({ where: { studentId, parentId: linked.parent.id }, include: { parent: { select: { name: true, relation: true } } } });
    const classSubjects = await prisma.classSubject.findMany({ where: { classId: linked.student.classId }, include: { subject: { select: { name: true } } }, orderBy: { subject: { name: "asc" } } });
    return res.json({ student: { id: studentId, classId: linked.student.classId, className: linked.student.class.name, section: linked.student.class.section }, classTeacher: linked.student.class.teacher?.name ?? linked.student.class.teachers[0]?.teacher.name ?? null, parent: parentLinks[0] ? { name: parentLinks[0].parent.name, relation: parentLinks[0].parent.relation } : null, subjects: classSubjects.map(item => item.subject.name) });
  } catch (error) { console.error("GET parent student profile", error); return res.status(500).json({ message: "Could not fetch student profile" }); }
});

router.get("/attendance/:studentId", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!Number.isSafeInteger(studentId) || studentId < 1) return res.status(400).json({ message: "Invalid student id" });
    const linked = await getLinkedStudent(req, studentId);
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
    let start: Date; let end: Date;
    if (typeof req.query.startDate === "string" || typeof req.query.endDate === "string") {
      if (!safeDate(req.query.startDate) || !safeDate(req.query.endDate)) return res.status(400).json({ message: "Provide valid startDate and endDate in YYYY-MM-DD format" });
      start = day(String(req.query.startDate)); end = new Date(day(String(req.query.endDate)).getTime() + 86_400_000);
      if (start >= end) return res.status(400).json({ message: "startDate must be on or before endDate" });
    } else {
      start = new Date(`${month}-01T00:00:00.000Z`);
      if (Number.isNaN(start.getTime())) return res.status(400).json({ message: "Invalid month" });
      end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    }
    const sessions = await prisma.attendanceSession.findMany({ where: { classId: linked.student.classId, date: { gte: start, lt: end } }, orderBy: { date: "asc" }, include: { attendances: { where: { studentId }, select: { status: true } } } });
    const records = sessions.map(session => ({ date: session.date.toISOString().slice(0, 10), status: session.attendances[0]?.status ?? "ABSENT" }));
    const present = records.filter(item => item.status === "PRESENT").length;
    const workingDays = records.length;
    return res.json({ studentId, month, summary: { workingDays, present, absent: workingDays - present, percentage: workingDays ? Math.round((present / workingDays) * 1000) / 10 : 0 }, records });
  } catch (error) { console.error("GET /parent/attendance", error); return res.status(500).json({ message: "Could not fetch student attendance" }); }
});

router.get("/homework/:studentId", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const linked = await getLinkedStudent(req, studentId);
    if (!Number.isSafeInteger(studentId) || studentId < 1) return res.status(400).json({ message: "Invalid student id" });
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    if (!["all", "upcoming", "past"].includes(status)) return res.status(400).json({ message: "status must be all, upcoming, or past" });
    const now = new Date();
    const homeworks = await prisma.homework.findMany({ where: { classId: linked.student.classId, ...(status === "upcoming" ? { dueDate: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } : status === "past" ? { dueDate: { lt: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } : {}) }, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }] });
    const teacherIds = [...new Set(homeworks.map(item => item.teacherId))];
    const teachers = await prisma.teacher.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true } });
    const teacherMap = new Map(teachers.map(item => [item.id, item.name]));
    return res.json({ studentId, homework: homeworks.map(item => ({ id: item.id, subject: item.subject, title: item.description, description: item.description, assignedDate: item.createdAt.toISOString(), dueDate: item.dueDate.toISOString(), due: item.dueDate.toISOString(), postedBy: teacherMap.get(item.teacherId) ?? "Class teacher", attachments: Array.isArray(item.attachments) ? item.attachments : [] })) });
  } catch (error) { console.error("GET /parent/homework", error); return res.status(500).json({ message: "Could not fetch student homework" }); }
});

router.get("/academics/:studentId", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const linked = await getLinkedStudent(req, studentId);
    if (!Number.isSafeInteger(studentId) || studentId < 1) return res.status(400).json({ message: "Invalid student id" });
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const exams = await prisma.exam.findMany({ where: { classId: linked.student.classId }, include: { subject: { select: { name: true } }, marks: { where: { studentId }, select: { marks: true } } }, orderBy: [{ examDate: "desc" }, { subject: { name: "asc" } }] });
    const resultsByExam = new Map<string, { name: string; date: string; subjects: { name: string; obtainedMarks: number; maxMarks: number; percentage: number }[] }>();
    const schedule = exams.map(exam => {
      const released = exam.isReleased;
      const mark = released ? exam.marks[0] : null;
      if (released && mark) {
        const key = `${exam.name}:${exam.examDate.toISOString()}`;
        const result = resultsByExam.get(key) ?? { name: exam.name, date: exam.examDate.toISOString(), subjects: [] };
        result.subjects.push({ name: exam.subject.name, obtainedMarks: Number(mark.marks), maxMarks: Number(exam.totalMarks), percentage: exam.totalMarks > 0 ? Math.round((Number(mark.marks) / exam.totalMarks) * 1000) / 10 : 0 });
        resultsByExam.set(key, result);
      }
      return { id: exam.id, name: exam.name, subject: exam.subject.name, date: exam.examDate.toISOString(), maxMarks: Number(exam.totalMarks), isReleased: released };
    });
    const results = [...resultsByExam.values()].map(result => {
      const obtained = result.subjects.reduce((sum, subject) => sum + subject.obtainedMarks, 0); const maximum = result.subjects.reduce((sum, subject) => sum + subject.maxMarks, 0);
      return { ...result, totalObtained: obtained, totalMax: maximum, percentage: maximum ? Math.round((obtained / maximum) * 1000) / 10 : 0 };
    });
    return res.json({ studentId, exams: schedule, results });
  } catch (error) { console.error("GET /parent/academics", error); return res.status(500).json({ message: "Could not fetch exams and results" }); }
});

router.get("/fees/:studentId", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const linked = await getLinkedStudent(req, studentId);
    if (!Number.isSafeInteger(studentId) || studentId < 1) return res.status(400).json({ message: "Invalid student id" });
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const fees = await prisma.fee.findMany({ where: { studentId }, include: { payments: { where: { status: "SUCCESS" }, orderBy: { createdAt: "desc" }, select: { id: true, amount: true, method: true, status: true, createdAt: true } } }, orderBy: [{ academicYear: "desc" }, { type: "asc" }] });
    const items = fees.map(fee => { const paid = fee.payments.reduce((sum, payment) => sum + Number(payment.amount), 0); return { id: fee.id, title: fee.title || fee.type.replaceAll("_", " "), type: fee.type, academicYear: fee.academicYear, total: Number(fee.total), paid, due: Math.max(0, Number(fee.total) - paid), payments: fee.payments.map(payment => ({ id: payment.id, amount: Number(payment.amount), method: payment.method, paidAt: payment.createdAt.toISOString(), receiptUrl: `/parent/fees/${studentId}/receipts/${payment.id}` })) }; });
    const total = items.reduce((sum, item) => sum + item.total, 0); const paid = items.reduce((sum, item) => sum + item.paid, 0);
    return res.json({ studentId, summary: { total, paid, due: Math.max(0, total - paid) }, fees: items });
  } catch (error) { console.error("GET /parent/fees", error); return res.status(500).json({ message: "Could not fetch student fee details" }); }
});

function pdfReceipt(lines: string[]) {
  const escape = (value: string) => value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?").replace(/[\\()]/g, "\\$&");
  const stream = lines.map((line, index) => `BT /F1 ${index === 0 ? 18 : 11} Tf 50 ${760 - index * 25} Td (${escape(line)}) Tj ET`).join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, "ascii")); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "ascii"); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

router.get("/fees/:studentId/receipts/:paymentId", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const paymentId = Number(req.params.paymentId); const linked = await getLinkedStudent(req, studentId);
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const payment = await prisma.payment.findFirst({ where: { id: paymentId, status: "SUCCESS", fee: { studentId } }, include: { fee: true } });
    if (!payment) return res.status(404).json({ message: "A verified receipt was not found" });
    const pdf = pdfReceipt(["IDPS KOVVUR - FEE RECEIPT", `Student: ${linked.student.name}`, `Fee: ${payment.fee.title || payment.fee.type}`, `Academic year: ${payment.fee.academicYear}`, `Amount paid: INR ${Number(payment.amount).toFixed(2)}`, `Payment method: ${payment.method}`, `Payment date: ${payment.createdAt.toISOString().slice(0, 10)}`, `Receipt reference: IDPS-${payment.id}`]);
    res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="IDPS-receipt-${payment.id}.pdf"`); res.setHeader("Content-Length", pdf.length);
    return res.send(pdf);
  } catch (error) { console.error("GET fee receipt", error); return res.status(500).json({ message: "Could not prepare fee receipt" }); }
});

router.get("/transport/:studentId", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const linked = await getLinkedStudent(req, studentId);
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const bus = linked.student.bus;
    if (!bus) return res.json({ studentId, assigned: false, transport: null });
    return res.json({ studentId, assigned: true, transport: { busId: bus.id, busNumber: `Bus ${bus.id}`, routeName: bus.route.join(" · "), route: bus.route, driver: { name: bus.driverName, phone: bus.phone } } });
  } catch (error) { console.error("GET /parent/transport", error); return res.status(500).json({ message: "Could not fetch transport details" }); }
});

router.get("/transport/:studentId/live", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const linked = await getLinkedStudent(req, studentId);
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const busId = linked.student.busId;
    if (!busId) return res.json({ active: false, reason: "NO_BUS" });
    let trip = await prisma.busTrip.findFirst({ where: { busId, status: "ACTIVE" }, orderBy: { startedAt: "desc" } });
    if (!trip) return res.json({ active: false, reason: "NO_ACTIVE_TRIP" });
    if (Date.now() - trip.lastPingAt.getTime() > 90_000 || !isBusTripWindowOpen(trip.period)) {
      await prisma.busTrip.updateMany({ where: { id: trip.id, status: "ACTIVE" }, data: { status: "EXPIRED", endedAt: new Date() } });
      return res.json({ active: false, reason: Date.now() - trip.lastPingAt.getTime() > 90_000 ? "LOCATION_STALE" : "OUTSIDE_WINDOW" });
    }
    return res.json({ active: true, tripId: trip.id, period: trip.period, startedAt: trip.startedAt, lastPingAt: trip.lastPingAt, location: { latitude: trip.latitude, longitude: trip.longitude, heading: trip.heading, speed: trip.speed, recordedAt: trip.lastPingAt }, driver: { name: linked.student.bus?.driverName, phone: linked.student.bus?.phone } });
  } catch (error) { console.error("GET live bus location", error); return res.status(500).json({ message: "Could not fetch live bus location" }); }
});

router.get("/leave-requests/:studentId", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.params.studentId); const linked = await getLinkedStudent(req, studentId);
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const rows = await prisma.leaveRequest.findMany({ where: { studentId, parentId: linked.parent.id }, include: { assignedTeacher: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return res.json({ studentId, requests: rows });
  } catch (error) { console.error("GET leave requests", error); return res.status(500).json({ message: "Could not fetch leave requests" }); }
});

router.get("/leave-requests", async (req: AuthRequest, res: Response) => {
  try {
    if (req.user.role === "PARENT") return res.status(400).json({ message: "Parents must provide a student id" });
    if (req.user.role !== "TEACHER" && !isExecutiveRole(req.user.role)) return res.status(403).json({ message: "You are not allowed to view leave requests" });
    const where: any = {};
    if (req.user.role === "TEACHER") {
      const teacher = await prisma.teacher.findUnique({ where: { userId: userIdOf(req) }, select: { id: true } });
      if (!teacher) return res.json({ requests: [] });
      where.assignedTeacherId = teacher.id;
    }
    if (typeof req.query.status === "string" && ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status)) where.status = req.query.status;
    const requests = await prisma.leaveRequest.findMany({ where, include: { student: { select: { id: true, name: true, class: { select: { name: true, section: true } } } }, parent: { select: { name: true, phone1: true } }, assignedTeacher: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    return res.json({ requests });
  } catch (error) { console.error("GET staff leave requests", error); return res.status(500).json({ message: "Could not fetch leave requests" }); }
});

router.post("/leave-requests", async (req: AuthRequest, res: Response) => {
  try {
    const studentId = Number(req.body?.studentId); const startDate = req.body?.startDate; const endDate = req.body?.endDate; const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!Number.isSafeInteger(studentId) || studentId < 1 || !safeDate(startDate) || !safeDate(endDate) || day(startDate) > day(endDate) || day(endDate) < day(schoolDate()) || !reason || reason.length > 1000) return res.status(400).json({ message: "Student, valid leave dates, and a reason are required" });
    const linked = await getLinkedStudent(req, studentId);
    if (!linked) return res.status(403).json({ message: "Student is not linked to this parent account" });
    const classTeacher = linked.student.class.teacher || linked.student.class.teachers[0]?.teacher;
    if (!classTeacher) return res.status(409).json({ message: "A class teacher is not assigned to this student yet" });
    const request = await prisma.leaveRequest.create({ data: { studentId, parentId: linked.parent.id, assignedTeacherId: classTeacher.id, startDate: day(startDate), endDate: day(endDate), reason }, include: { assignedTeacher: { select: { name: true } } } });
    void notifyStaff([classTeacher.userId], "New parent leave request", "A leave request is waiting for your review.").catch(error => console.warn("Could not notify class teacher", error?.message));
    return res.status(201).json({ message: "Leave request sent to the class teacher", data: request });
  } catch (error) { console.error("POST leave request", error); return res.status(500).json({ message: "Could not submit leave request" }); }
});

router.patch("/leave-requests/:id/status", async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id); const status = req.body?.status;
    if (!Number.isSafeInteger(id) || !["APPROVED", "REJECTED"].includes(status)) return res.status(400).json({ message: "A valid request id and decision are required" });
    const request = await prisma.leaveRequest.findUnique({ where: { id }, include: { assignedTeacher: { select: { userId: true } } } });
    if (!request) return res.status(404).json({ message: "Leave request not found" });
    const allowed = req.user.role === "TEACHER" && request.assignedTeacher.userId === userIdOf(req) || isExecutiveRole(req.user.role);
    if (!allowed) return res.status(403).json({ message: "Only the assigned class teacher or school leadership can respond" });
    const updated = await prisma.leaveRequest.update({ where: { id }, data: { status, teacherResponse: typeof req.body?.response === "string" ? req.body.response.trim().slice(0, 1000) || null : null } });
    return res.json({ message: "Leave request updated", data: updated });
  } catch (error) { console.error("PATCH leave request", error); return res.status(500).json({ message: "Could not update leave request" }); }
});

export default router;
