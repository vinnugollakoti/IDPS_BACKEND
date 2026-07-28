import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";

export interface AuthRequest extends Request<any, any, any, any> {
  headers: any;
  body: any;
  user?: any;
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ message: "No token" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function isExecutiveRole(role: string): boolean {
  return role === "PRINCIPAL" || role === "DIRECTOR" || role === "CHAIRMAN";
}

export function isStaffRole(role: string): boolean {
  return isExecutiveRole(role) || role === "RECEPTIONIST" || role === "TEACHER";
}
