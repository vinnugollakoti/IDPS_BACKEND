import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const FALLBACK_JWT_SECRET = "e3b2157febfc1cee8d71ab4e20d1a17474cc875d6f6517d0e20d274c5068d886";
const JWT_SECRET: string = (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
  ? process.env.JWT_SECRET
  : FALLBACK_JWT_SECRET;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn('[SECURITY WARNING] JWT_SECRET is not configured or shorter than 32 characters in environment variables. Using fallback secret.');
}

export function generateToken(userId: number, role: string) {
  return jwt.sign(
    { userId, role },
    JWT_SECRET,
    { expiresIn: "240d" }
  );
}

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET);
}
