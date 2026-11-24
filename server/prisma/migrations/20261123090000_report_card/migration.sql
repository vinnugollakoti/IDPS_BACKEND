CREATE TABLE "ReportCard" (
  "examId" INTEGER NOT NULL REFERENCES "Exam"("id") ON DELETE CASCADE,
  "studentId" INTEGER NOT NULL REFERENCES "Student"("id") ON DELETE CASCADE,
  "fields" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("examId","studentId")
);
