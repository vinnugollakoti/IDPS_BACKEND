HTTP response codes

200 = success
201 = created
400 = invalid request
401 = authentication required or invalid token
403 = insufficient permissions
404 = resource missing
409 = conflict
422 = validation failed
429 = rate limit exceeded
500 = internal error
503 = service unavailable

CREARTION
Parent ( completed ) - user.ts
Student ( completed ) - user.ts
Class ( completed ) - class.ts
Teacher ( completed ) - user.ts
User ( completed ) - user.ts
Mark - class.ts ( completed )
ClassSubject - class.ts ( completed )
Subject - class.ts ( completed )
Exam - class.ts ( completed )
Fee - fee.ts ( completed )
Payment - fee.ts ( completed )
--------------------------
Notice - global.ts  -> next_version : 0.0.2
Homework - class.ts
AttendanceSession - class.ts
Attendance - class.ts
TimeTable - global.ts -> next_version : 0.0.2
Bus - global.ts
Feedback - global.ts


EDIT AND UPDATE
Parent ( completed )
Student ( completed )
Class  ( completd )
Teacher ( completed )
Mark ( completed )
ClassSubject ( not required )
Subject ( completed )
Exam ( completed )
Fee ( completed )
Payment ( completd )


GET
Parent ( completed )
Student ( comppleted )
Class ( completed )
Teacher ( completed )
Mark ( completed )
ClassSubject ( not required )
Subject ( completed )
Exam ( completed )
Fee ( completed )
Payment ( completed )


DELETE
Parent
Student
Class
Teacher
Mark
ClassSubject
Subject
Exam
Fee
Payment





Notes :
- There should be a function to promote each class with students selection.