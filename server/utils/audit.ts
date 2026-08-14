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

    const rawUserId = user?.userId ?? user?.id;
    if (!rawUserId) {
      return;
    }

    const userId = Number(rawUserId);

    // Fetch rich performer details (Name, Phone, Role) from DB
    const performer = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        role: true,
        teacher: { select: { phone: true, name: true } },
        parent: { select: { phone1: true, name: true } },
      },
    });

    const performerName = performer?.name || performer?.teacher?.name || performer?.parent?.name || user?.name || user?.role || "Staff Member";
    const performerPhone = performer?.teacher?.phone || performer?.parent?.phone1 || "N/A";
    const performerRole = performer?.role || user?.role || "STAFF";

    const enrichedDetails = details.startsWith('[')
      ? details.replace(/^\[([^\]]+)\]/, `[$1 | Performed By: ${performerName} (Phone: ${performerPhone}, Role: ${performerRole})]`)
      : `[Performed By: ${performerName} (Phone: ${performerPhone}, Role: ${performerRole})] ${details}`;

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
        details: enrichedDetails,
        entityType: entityType || null,
        entityId: entityId !== undefined && entityId !== null ? String(entityId) : null,
        performedById: userId,
        performedByRole: performerRole as Role,
        ipAddress: ipAddress ? ipAddress.substring(0, 45) : null,
        userAgent: userAgent ? userAgent.substring(0, 255) : null,
      },
    });
  } catch (err) {
    console.error("⚠️ AuditLog Error (Non-blocking):", err);
  }
}
