import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";
import prisma from "../prisma/client";

export interface AuthRequest extends Request<any, any, any, any> {
  headers: any;
  body: any;
  user?: any;
}

export async function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ message: "No token" });
  }

  const [scheme, token, ...extra] = header.trim().split(/\s+/);
  if (scheme !== "Bearer" || !token || extra.length > 0) {
    return res.status(401).json({ message: "Authorization header must use Bearer token format" });
  }

  try {
    const decoded = verifyToken(token) as any;
    if (!decoded || typeof decoded !== "object" || !Number.isInteger(Number(decoded.userId)) || !decoded.role || decoded.tokenVersion !== 1) {
      return res.status(401).json({ message: "Invalid token payload" });
    }
    let account;
    try {
      account = await prisma.user.findUnique({ where: { id: Number(decoded.userId) }, select: { role: true } });
    } catch {
      return res.status(503).json({ message: "Unable to verify account access" });
    }
    if (!account || account.role !== decoded.role) {
      return res.status(401).json({ message: "Account access changed. Please sign in again." });
    }
    req.user = { ...decoded, role: account.role };
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function isExecutiveRole(role?: string): boolean {
  if (!role || typeof role !== "string") return false;
  const r = role.trim().toUpperCase();
  return r === "PRINCIPAL" || r === "DIRECTOR" || r === "CHAIRMAN";
}

export function isStaffRole(role?: string): boolean {
  if (!role || typeof role !== "string") return false;
  const r = role.trim().toUpperCase();
  return isExecutiveRole(r) || r === "RECEPTIONIST" || r === "TEACHER";
}
