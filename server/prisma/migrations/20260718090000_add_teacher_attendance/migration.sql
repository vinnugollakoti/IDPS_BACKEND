CREATE TABLE "TeacherAttendance" (
    "id" SERIAL NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selfieUrl" TEXT NOT NULL,
    "selfiePath" TEXT NOT NULL,
    "selfieMimeType" TEXT NOT NULL,
    "selfieSizeBytes" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "deviceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherAttendance_teacherId_attendanceDate_key" ON "TeacherAttendance"("teacherId", "attendanceDate");
CREATE INDEX "TeacherAttendance_attendanceDate_idx" ON "TeacherAttendance"("attendanceDate");
CREATE INDEX "TeacherAttendance_teacherId_idx" ON "TeacherAttendance"("teacherId");

ALTER TABLE "TeacherAttendance"
ADD CONSTRAINT "TeacherAttendance_teacherId_fkey"
FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
