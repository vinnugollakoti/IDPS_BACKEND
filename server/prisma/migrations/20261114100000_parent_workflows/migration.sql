CREATE TYPE "ComplaintRecipient" AS ENUM ('CLASS_TEACHER', 'PRINCIPAL');
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Complaint"
  ADD COLUMN "studentId" INTEGER,
  ADD COLUMN "recipientType" "ComplaintRecipient" NOT NULL DEFAULT 'PRINCIPAL',
  ADD COLUMN "assignedTeacherId" INTEGER;

CREATE INDEX "Complaint_studentId_idx" ON "Complaint"("studentId");
CREATE INDEX "Complaint_assignedTeacherId_idx" ON "Complaint"("assignedTeacherId");

ALTER TABLE "Complaint"
  ADD CONSTRAINT "Complaint_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Complaint_assignedTeacherId_fkey" FOREIGN KEY ("assignedTeacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LeaveRequest" (
  "id" SERIAL NOT NULL,
  "studentId" INTEGER NOT NULL,
  "parentId" INTEGER NOT NULL,
  "assignedTeacherId" INTEGER NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
  "teacherResponse" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeaveRequest_studentId_startDate_idx" ON "LeaveRequest"("studentId", "startDate");
CREATE INDEX "LeaveRequest_parentId_createdAt_idx" ON "LeaveRequest"("parentId", "createdAt");
CREATE INDEX "LeaveRequest_assignedTeacherId_status_idx" ON "LeaveRequest"("assignedTeacherId", "status");

ALTER TABLE "LeaveRequest"
  ADD CONSTRAINT "LeaveRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LeaveRequest_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LeaveRequest_assignedTeacherId_fkey" FOREIGN KEY ("assignedTeacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
