CREATE TABLE "StudentFeedback" (
  "id" SERIAL PRIMARY KEY,
  "studentId" INTEGER NOT NULL REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "authorId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "authorName" TEXT NOT NULL,
  "message" VARCHAR(2000) NOT NULL CHECK (length(trim("message")) > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StudentFeedback_studentId_id_idx" ON "StudentFeedback"("studentId", "id");
-- Access is through the authenticated school API, never Supabase's public REST API.
ALTER TABLE "StudentFeedback" ENABLE ROW LEVEL SECURITY;
