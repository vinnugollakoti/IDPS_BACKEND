import { createHash } from "node:crypto";
import { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

const keyPart = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

export function authRateLimit(options: { windowMs: number; max: number; action: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
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
      return next();
    }

    if (current.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ message: "Too many authentication attempts. Please try again later." });
    }

    current.count += 1;
    return next();
  };
}
