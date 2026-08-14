ALTER TABLE "Student" ADD COLUMN "studentCode" TEXT;

WITH numbered AS (
  SELECT id, 'S-' || LPAD(ROW_NUMBER() OVER (ORDER BY id)::text, 3, '0') AS code
  FROM "Student"
)
UPDATE "Student" AS s SET "studentCode" = numbered.code
FROM numbered WHERE s.id = numbered.id;

CREATE UNIQUE INDEX "Student_studentCode_key" ON "Student"("studentCode");
