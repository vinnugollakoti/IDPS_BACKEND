import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET ?? "";
const JWT_ISSUER = process.env.JWT_ISSUER || "idps-backend";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "idps-staff-app";

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters; refusing to start without a production secret");
}

export function generateToken(userId: number, role: string) {
  return jwt.sign(
    { userId, role, tokenVersion: 1 },
    JWT_SECRET,
    { expiresIn: "240d", issuer: JWT_ISSUER, audience: JWT_AUDIENCE, subject: String(userId) }
  );
}

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}
