CREATE TABLE "OtpRateLimit" (
    "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "action" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY ("userId", "action")
);

-- Codes issued by older API versions must be requested again after rollout.
UPDATE "User" SET otp = NULL, "otpExpiry" = NULL WHERE otp IS NOT NULL;
