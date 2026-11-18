ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DRIVER';

CREATE TABLE "Driver" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "photo" TEXT,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
