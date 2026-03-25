import { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";

export interface AuthRequest extends Request<any, any, any, any> {
  headers: any;
  body: { photo: any; name: any; gender: any; dob: any; classId: any; busId: any; parentIds: any; };
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