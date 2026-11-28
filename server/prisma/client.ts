import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;

if (!connectionString) {
  throw new Error("Neither DATABASE_URL nor DIRECT_URL is defined");
}

// Keep the default modest for the 512 MB instance; allow tuning from real
// pool-wait measurements without shipping another build.
const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX);
const poolMax = Number.isSafeInteger(configuredPoolMax) && configuredPoolMax >= 1 && configuredPoolMax <= 10
  ? configuredPoolMax : 5;
const pool = new Pool({
  connectionString,
  max: poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client pool:", err);
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, omit: { user: { otp: true, otpExpiry: true, phone: true } } });

export default prisma;
