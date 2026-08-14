import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import AuthRouter from "./routes/auth"
import ClassRouter from "./routes/class"
import StudentRouter from "./routes/student"
import TeacherRouter from "./routes/teacher"
import UserRouter from "./routes/user"
import StudentAttendanceRouter from "./routes/studentAttendance"
import GetRouter from "./routes/get"
import NotificationsRouter from "./routes/notifications"
import PermissionRouter from "./routes/permission"
import HomeworkRouter from "./routes/homework"
import ExpensesRouter from "./routes/expenses"
import prisma from "./prisma/client";
dotenv.config();


const app = express();
app.disable("etag");
app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

type ServiceHealth = {
    status: "up" | "down" | "configured" | "not_configured";
    message: string;
    details?: Record<string, unknown>;
};

const maskValue = (value?: string) => {
    if (!value) return null;
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const normalizeSupabaseUrl = () => {
    return process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
};

const checkDatabase = async (): Promise<ServiceHealth> => {
    try {
        const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Database health check timed out after 5 seconds")), 5000);
        });
        await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
        return {
            status: "up",
            message: "Database connection is working"
        };
    } catch (err) {
        return {
            status: "down",
            message: "Database connection failed",
            details: {
                error: err instanceof Error ? err.message : "Unknown database error"
            }
        };
    }
};

const checkMailService = (): ServiceHealth => {
    const hasMailApi = Boolean(process.env.MAIL_API);
    const hasMailId = Boolean(process.env.MAIL_ID);
    const hasMailPassword = Boolean(process.env.MAIL_PASSWORD);
    const configured = hasMailApi && hasMailId && hasMailPassword;

    return {
        status: configured ? "configured" : "not_configured",
        message: configured
            ? "Mail service configuration is set"
            : "Mail service configuration is incomplete",
        details: {
            mailApiConfigured: hasMailApi,
            mailIdConfigured: hasMailId,
            mailPasswordConfigured: hasMailPassword,
            mailId: maskValue(process.env.MAIL_ID)
        }
    };
};

const checkSupabaseStorage = async (): Promise<ServiceHealth> => {
    const supabaseUrl = normalizeSupabaseUrl();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucketAttendance = process.env.SUPABASE_TEACHER_ATTENDANCE_BUCKET ?? "teacher-attendance";
    const bucketProfiles = process.env.SUPABASE_USER_PROFILES_BUCKET ?? "user-profiles";

    if (!supabaseUrl || !serviceRoleKey) {
        return {
            status: "not_configured",
            message: "Supabase Storage configuration is incomplete",
            details: {
                supabaseUrlConfigured: Boolean(supabaseUrl),
                serviceRoleKeyConfigured: Boolean(serviceRoleKey),
            }
        };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const [resAtt, resProf] = await Promise.all([
            fetch(`${supabaseUrl}/storage/v1/bucket/${bucketAttendance}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
                signal: controller.signal
            }).catch(() => null),
            fetch(`${supabaseUrl}/storage/v1/bucket/${bucketProfiles}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
                signal: controller.signal
            }).catch(() => null)
        ]);
        clearTimeout(timeout);

        const attOk = resAtt?.ok ?? false;
        const profOk = resProf?.ok ?? false;

        if (!attOk && !profOk) {
            return {
                status: "down",
                message: "Supabase Storage buckets check failed",
                details: { bucketAttendance: attOk, bucketProfiles: profOk }
            };
        }

        return {
            status: "up",
            message: "Supabase Storage buckets are reachable",
            details: { bucketAttendance: attOk, bucketProfiles: profOk }
        };
    } catch (err) {
        return {
            status: "down",
            message: "Supabase Storage check failed",
            details: { error: err instanceof Error ? err.message : "Unknown Supabase Storage error" }
        };
    }
};

const checkJwt = (): ServiceHealth => {
    return {
        status: process.env.JWT_SECRET ? "configured" : "not_configured",
        message: process.env.JWT_SECRET ? "JWT secret is configured" : "JWT secret is missing"
    };
};

const getHealthCheckResponse = async (_req: Request, res: Response) => {
    try {
        const [database, supabaseStorage] = await Promise.all([
            checkDatabase(),
            checkSupabaseStorage()
        ]);

        const services = {
            server: {
                status: "up",
                message: "Backend server is live"
            },
            database,
            mail: checkMailService(),
            supabaseStorage,
            jwt: checkJwt()
        };

        const allHealthy = Object.values(services).every((service) => {
            return service.status === "up" || service.status === "configured";
        });

        return res.status(allHealthy ? 200 : 503).json({
            status: allHealthy ? "healthy" : "unhealthy",
            message: allHealthy
                ? "Backend server is live and required services are ready"
                : "Backend server is live but one or more services need attention",
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            environment: process.env.NODE_ENV ?? "development",
            services
        });
    } catch(err) {
        console.log(err);
        return res.status(500).json({
            status: "error",
            message: "Health check failed",
            timestamp: new Date().toISOString()
        });
    }
};

app.get("/health-check", getHealthCheckResponse);
app.get("/health", getHealthCheckResponse);
app.get("/health/database", async (_req: Request, res: Response) => {
    const database = await checkDatabase();
    return res.status(database.status === "up" ? 200 : 503).json({
        status: database.status === "up" ? "healthy" : "unhealthy",
        database,
        timestamp: new Date().toISOString(),
    });
});

app.use("/", UserRouter);
app.use("/attendance", StudentAttendanceRouter);
app.use("/auth", AuthRouter);
app.use("/class", ClassRouter);
app.use("/student", StudentRouter);
app.use("/teacher", TeacherRouter);
app.use("/get", GetRouter);
app.use("/notifications", NotificationsRouter);
app.use("/permission", PermissionRouter);
app.use("/homework", HomeworkRouter);
app.use("/expenses", ExpensesRouter);


const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
    console.log(`Your server is running on port ${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Stop the existing backend process before starting another one.`);
    } else {
        console.error("Backend server failed to start:", error);
    }
    process.exitCode = 1;
});
