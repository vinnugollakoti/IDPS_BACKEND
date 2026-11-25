import { createHash } from "node:crypto";
import { Request, Response, NextFunction } from "express";

import prisma from "../prisma/client";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

const keyPart = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

export function authRateLimit(options: { windowMs: number; max: number; action: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "anonymous";
    const ip = req.socket.remoteAddress || "unknown";
    const key = `${options.action}:${keyPart(email)}:${keyPart(ip)}`;
    const now = Date.now();

    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      lastCleanup = now;
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    } else if (current.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ message: "Too many authentication attempts. Please try again later." });
    } else {
      current.count += 1;
    }

    // One shared counter per registered account and action, across API replicas.
    // Unknown addresses create no database rows.
    const action = options.action.replace("parent-email-", "");
    try {
      const [bucket] = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
        INSERT INTO "OtpRateLimit" ("userId", action, count, "resetAt")
        SELECT id, ${action}, 1, now() + ${options.windowMs} * interval '1 millisecond'
        FROM "User" WHERE email = ${email}
        ON CONFLICT ("userId", action) DO UPDATE SET
          count = CASE WHEN "OtpRateLimit"."resetAt" <= now() THEN 1
                       ELSE least("OtpRateLimit".count + 1, ${options.max + 1}::int) END,
          "resetAt" = CASE WHEN "OtpRateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt"
                           ELSE "OtpRateLimit"."resetAt" END
        RETURNING count, "resetAt"`;
      if (bucket && bucket.count > options.max) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000))));
        return res.status(429).json({ message: "Too many authentication attempts. Please try again later." });
      }
    } catch {
      return res.status(503).json({ message: "Authentication is temporarily unavailable." });
    }
    return next();
  };
}
