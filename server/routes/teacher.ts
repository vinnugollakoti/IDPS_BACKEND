import express, { Request, Response } from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
import { parseTeacherSelfie, uploadTeacherAttendanceSelfie } from "../lib/supabaseStorage";

const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};

const getRequestIp = (req: Request) => {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
        return forwardedFor.split(",")[0].trim();
    }

    return req.ip || req.socket.remoteAddress || null;
};

const startOfDayUtc = (date: Date) => {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const parseOptionalDate = (value: unknown) => {
    if (value === undefined || value === null || value === "") {
        return new Date();
    }

    if (typeof value !== "string") {
        throw new Error("capturedAt must be a valid date string");
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error("capturedAt must be a valid date string");
    }

    return date;
};

const parseOptionalNumber = (value: unknown, field: string) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${field} must be a valid number`);
    }

    return parsed;
};

const requireTeacher = async (req: AuthRequest, res: Response) => {
    if (req.user?.role !== "TEACHER") {
        res.status(403).json({ message: "Only teachers can use teacher attendance" });
        return null;
    }

    const authUserId = resolveAuthUserId(req.user);
    if (!authUserId) {
        res.status(401).json({ message: "Invalid token payload" });
        return null;
    }

    const teacher = await prisma.teacher.findUnique({
        where: { userId: authUserId },
        include: { user: true }
    });

    if (!teacher) {
        res.status(404).json({ message: "Teacher profile not found" });
        return null;
    }

    return teacher;
};

router.post("/attendance", auth, async (req: AuthRequest, res: Response) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return;

        const {
            imageBase64,
            imageMimeType,
            capturedAt,
            latitude,
            longitude,
            accuracy,
            deviceId
        } = req.body as {
            imageBase64?: string;
            imageMimeType?: string;
            capturedAt?: string;
            latitude?: number | string;
            longitude?: number | string;
            accuracy?: number | string;
            deviceId?: string;
        };

        const capturedDate = parseOptionalDate(capturedAt);
        const attendanceDate = startOfDayUtc(capturedDate);
        const now = new Date();

        if (capturedDate.getTime() - now.getTime() > 5 * 60 * 1000) {
            return res.status(400).json({ message: "capturedAt cannot be more than 5 minutes in the future" });
        }

        parseTeacherSelfie(imageBase64, imageMimeType);

        const existingAttendance = await prisma.teacherAttendance.findUnique({
            where: {
                teacherId_attendanceDate: {
                    teacherId: teacher.id,
                    attendanceDate
                }
            }
        });

        if (existingAttendance) {
            return res.status(409).json({
                message: "Teacher attendance already submitted for today",
                data: existingAttendance
            });
        }

        const latitudeValue = parseOptionalNumber(latitude, "latitude");
        const longitudeValue = parseOptionalNumber(longitude, "longitude");
        const accuracyValue = parseOptionalNumber(accuracy, "accuracy");

        if (latitudeValue !== null && (latitudeValue < -90 || latitudeValue > 90)) {
            return res.status(400).json({ message: "latitude must be between -90 and 90" });
        }

        if (longitudeValue !== null && (longitudeValue < -180 || longitudeValue > 180)) {
            return res.status(400).json({ message: "longitude must be between -180 and 180" });
        }

        if (accuracyValue !== null && accuracyValue < 0) {
            return res.status(400).json({ message: "accuracy cannot be negative" });
        }

        const dateKey = attendanceDate.toISOString().slice(0, 10);
        const storagePath = `teachers/${teacher.id}/${dateKey}/${Date.now()}`;
        const uploadedSelfie = await uploadTeacherAttendanceSelfie({
            imageBase64: imageBase64!,
            imageMimeType,
            path: storagePath
        });

        const attendance = await prisma.teacherAttendance.create({
            data: {
                teacherId: teacher.id,
                attendanceDate,
                capturedAt: capturedDate,
                submittedAt: now,
                ...uploadedSelfie,
                latitude: latitudeValue,
                longitude: longitudeValue,
                accuracy: accuracyValue,
                deviceId: typeof deviceId === "string" && deviceId.trim() ? deviceId.trim().slice(0, 120) : null,
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null
            },
            include: {
                teacher: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                role: true
                            }
                        }
                    }
                }
            }
        });

        return res.status(201).json({
            message: "Teacher attendance submitted successfully",
            data: attendance
        });
    } catch (err: any) {
        console.log(err);
        const message = err instanceof Error ? err.message : "Failed to submit teacher attendance";
        const status = message.includes("Supabase storage is not configured") ? 500 : 400;
        return res.status(status).json({ message });
    }
});

router.get("/attendance/today", auth, async (req: AuthRequest, res: Response) => {
    try {
        const teacher = await requireTeacher(req, res);
        if (!teacher) return;

        const attendanceDate = startOfDayUtc(new Date());
        const attendance = await prisma.teacherAttendance.findUnique({
            where: {
                teacherId_attendanceDate: {
                    teacherId: teacher.id,
                    attendanceDate
                }
            }
        });

        return res.json({
            message: "Fetched teacher attendance status",
            data: {
                submitted: Boolean(attendance),
                attendance
            }
        });
    } catch (err) {
        console.log(err);
        return res.status(400).json({ message: "Failed to fetch teacher attendance status" });
    }
});

router.get("/attendance", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== "TEACHER" && req.user?.role !== "PRINCIPAL" && req.user?.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const authUserId = resolveAuthUserId(req.user);
        if (!authUserId) {
            return res.status(401).json({ message: "Invalid token payload" });
        }

        const teacherIdParam = req.query.teacherId ? Number(req.query.teacherId) : null;
        const from = req.query.from ? startOfDayUtc(parseOptionalDate(String(req.query.from))) : null;
        const to = req.query.to ? startOfDayUtc(parseOptionalDate(String(req.query.to))) : null;

        let teacherId = teacherIdParam;
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId },
                select: { id: true }
            });
            if (!teacher) {
                return res.status(404).json({ message: "Teacher profile not found" });
            }
            teacherId = teacher.id;
        }

        if (teacherId !== null && (!Number.isFinite(teacherId) || teacherId <= 0)) {
            return res.status(400).json({ message: "teacherId must be a valid number" });
        }

        const records = await prisma.teacherAttendance.findMany({
            where: {
                ...(teacherId ? { teacherId } : {}),
                ...((from || to) && {
                    attendanceDate: {
                        ...(from ? { gte: from } : {}),
                        ...(to ? { lte: to } : {})
                    }
                })
            },
            include: {
                teacher: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                role: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                attendanceDate: "desc"
            },
            take: 100
        });

        return res.json({
            message: "Fetched teacher attendance records",
            data: records
        });
    } catch (err) {
        console.log(err);
        return res.status(400).json({ message: "Failed to fetch teacher attendance records" });
    }
});

export default router;
