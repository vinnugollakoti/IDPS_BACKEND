import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;

if (!connectionString) {
  throw new Error("Neither DATABASE_URL nor DIRECT_URL is defined");
}

// Optimize pool to prevent holding excessive idle connections open on Supabase
const pool = new Pool({
  connectionString,
  max: 5,                  // Reduced connection cap to save Supabase DB RAM
  idleTimeoutMillis: 10000, // Close idle connections after 10s
  connectionTimeoutMillis: 5000,
  keepAlive: true,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client pool:", err);
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default prisma;