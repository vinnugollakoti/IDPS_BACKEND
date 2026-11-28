CREATE INDEX "ParentStudent_studentId_idx" ON "ParentStudent"("studentId");
CREATE INDEX "Student_busId_idx" ON "Student"("busId");
CREATE INDEX "Class_teacherId_idx" ON "Class"("teacherId");
CREATE INDEX "LeaveRequest_status_createdAt_idx" ON "LeaveRequest"("status", "createdAt");
CREATE INDEX "ClassSubject_subjectId_idx" ON "ClassSubject"("subjectId");
CREATE INDEX "Fee_createdAt_idx" ON "Fee"("createdAt");
CREATE INDEX "ReportCard_studentId_idx" ON "ReportCard"("studentId");
