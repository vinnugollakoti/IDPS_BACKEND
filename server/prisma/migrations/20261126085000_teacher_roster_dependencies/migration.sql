-- Existing schools may already have these schema objects from an earlier db push.
-- Fill the gaps in fresh installations without rewriting existing assignments.
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "photo" TEXT;
DO $$
BEGIN
  IF to_regclass('"ClassTeacher"') IS NULL THEN
    CREATE TABLE "ClassTeacher" (
      "classId" INTEGER NOT NULL REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "teacherId" INTEGER NOT NULL REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      PRIMARY KEY ("classId","teacherId")
    );
    ALTER TABLE "ClassTeacher" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "ClassTeacher_teacherId_idx" ON "ClassTeacher"("teacherId");
CREATE INDEX IF NOT EXISTS "ClassTeacher_classId_idx" ON "ClassTeacher"("classId");
