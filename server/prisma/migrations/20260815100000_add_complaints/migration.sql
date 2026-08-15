CREATE TYPE "ComplaintMode" AS ENUM ('OPEN', 'ANONYMOUS');
CREATE TYPE "ComplaintPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

CREATE TABLE "Complaint" (
  "id" SERIAL NOT NULL,
  "mode" "ComplaintMode" NOT NULL DEFAULT 'OPEN',
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT,
  "priority" "ComplaintPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
  "studentName" TEXT,
  "studentCode" TEXT,
  "parentName" TEXT,
  "parentPhone" TEXT,
  "response" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "submittedById" INTEGER,
  CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");
CREATE INDEX "Complaint_createdAt_idx" ON "Complaint"("createdAt");
CREATE INDEX "Complaint_submittedById_idx" ON "Complaint"("submittedById");
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
