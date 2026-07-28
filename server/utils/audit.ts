import prisma from "../prisma/client";
import { Role } from "../generated/prisma/client";
import { AuthRequest } from "../middleware/auth";

export type AuditTag =
  | "FEE"
  | "STUDENT"
  | "ATTENDANCE"
  | "EXAM"
  | "NOTICE"
  | "AUTH"
  | "CLASS"
  | "TEACHER"
  | "SYSTEM";

export interface LogAuditOptions {
  req: AuthRequest;
  action: string;
  tag: AuditTag;
  details: string;
  entityType?: string;
  entityId?: string | number;
}

/**
 * Safely creates an audit log entry in PostgreSQL database.
 * Non-blocking: Errors in logging are logged to console without breaking API responses.
 */
export async function logAudit(options: LogAuditOptions): Promise<void> {
  try {
    const { req, action, tag, details, entityType, entityId } = options;
    const user = req.user;

    if (!user || !user.id) {
      return;
    }

    const rawIp =
      (req.headers["x-forwarded-for"] as string) ||
      req.socket?.remoteAddress ||
      "";
    const ipAddress = rawIp.split(",")[0].trim();
    const userAgent = (req.headers["user-agent"] as string) || undefined;

    await (prisma as any).auditLog.create({
      data: {
        action,
        tag,
        details,
        entityType: entityType || null,
        entityId: entityId !== undefined && entityId !== null ? String(entityId) : null,
        performedById: Number(user.id),
        performedByRole: user.role as Role,
        ipAddress: ipAddress ? ipAddress.substring(0, 45) : null,
        userAgent: userAgent ? userAgent.substring(0, 255) : null,
      },
    });
  } catch (err) {
    console.error("⚠️ AuditLog Error (Non-blocking):", err);
  }
}
