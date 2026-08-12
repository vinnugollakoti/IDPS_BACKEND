import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole, isStaffRole } from "../middleware/auth";
import { logAudit } from "../utils/audit";
import { serverCache } from "../utils/cache";
const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};


router.post("/create-class", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const {name, section, teacherId} = req.body;

        if (!name || !section || !teacherId) {
            return res.status(500).json({message : "Missing required fields"});
        }

        const existingClass = await prisma.class.findUnique({
            where: {
                name_section: {
                name,
                section
                }
            }
        });

        if (existingClass) {
            return res.status(400).json({message: "Class already created"})
        }

        const result = await prisma.$transaction(async (tx) => {

            const teacher = await tx.class.create({
                data: {
                    name,
                    section,
                    teacherId
                }
            })

            return teacher;
        })

        // The classes endpoint is cached for the Workspace screen. Invalidate
        // it immediately so a newly-created class is visible without leaving
        // and reopening the app.
        void serverCache.clear();

        void logAudit({
            req,
            action: "CREATE_CLASS",
            tag: "CLASS",
            details: `Created Class ${name} ${section}`,
            entityType: "Class",
            entityId: result.id,
        });

        res.json({message: "Class created successfully", data: result})
    } catch (err) {
        console.log(err)
        return res.status(500).json({message: "Error creating class"})
    }
});


router.post("/create-subject", auth, async (req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST" && req.user.role !== "TEACHER") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const {name, classId} = req.body;

        if (!name || !classId) {
            return res.status(500).json({message: "You missed required inputs"});
        }

        let subject = await prisma.subject.findUnique({
            where: {name}
        })

        if (!subject) {
            subject = await prisma.subject.create ({
                data: { name }
            })
        }

        const existing = await prisma.classSubject.findUnique({
            where : {
                classId_subjectId: {
                    classId, 
                    subjectId: subject.id
                }
            }
        })

        if (existing) {
            return res.status(400).json({
                message: "Subject already existed and assigned to class"
            })
        }

        const classSubject = await prisma.classSubject.create({
            data: {
                classId,
                subjectId: subject.id
            },

            include: {
                class: true,
                subject: true
            }
        });

        res.json({message: "Subject created successfully", data: classSubject})

    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Failed to create subject."})
    }
})


router.post("/create-exam", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== 'TEACHER' && req.user.role !== 'PRINCIPAL' && req.user.role !== 'RECEPTIONIST') {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const { exam_name, name, totalMarks, subjectId, examDate, startDate, classId, subjects } = req.body;
        const examTitle = exam_name || name;
        const eDate = examDate ? new Date(examDate) : (startDate ? new Date(startDate) : new Date());

        if (!examTitle || !classId) {
            return res.status(400).json({message : "Missing required fields: exam title and classId are required"});
        }

        // Case 1: Standard single subject exam or multiple subjects array
        const subjectsToCreate: Array<{ name: string; maxMarks: number }> = [];

        if (Array.isArray(subjects) && subjects.length > 0) {
            for (const s of subjects) {
                if (s.name && s.name.trim()) {
                    subjectsToCreate.push({
                        name: s.name.trim(),
                        maxMarks: Number(s.maxMarks) || Number(totalMarks) || 100
                    });
                }
            }
        } else if (subjectId) {
            const existingSubject = await prisma.subject.findUnique({ where: { id: Number(subjectId) } });
            if (existingSubject) {
                subjectsToCreate.push({
                    name: existingSubject.name,
                    maxMarks: Number(totalMarks) || 100
                });
            }
        }

        if (subjectsToCreate.length === 0) {
            subjectsToCreate.push({
                name: 'General',
                maxMarks: Number(totalMarks) || 100
            });
        }

        const createdExams = await prisma.$transaction(async (tx) => {
            const results = [];
            for (const item of subjectsToCreate) {
                // Ensure Subject exists
                let subjectObj = await tx.subject.findUnique({ where: { name: item.name } });
                if (!subjectObj) {
                    subjectObj = await tx.subject.create({ data: { name: item.name } });
                }

                // Ensure ClassSubject relation exists
                const classSub = await tx.classSubject.findUnique({
                    where: { classId_subjectId: { classId: Number(classId), subjectId: subjectObj.id } }
                });
                if (!classSub) {
                    await tx.classSubject.create({
                        data: { classId: Number(classId), subjectId: subjectObj.id }
                    });
                }

                // Check if exam record already exists
                const existingExam = await tx.exam.findUnique({
                    where: {
                        name_subjectId_classId: {
                            name: examTitle,
                            subjectId: subjectObj.id,
                            classId: Number(classId)
                        }
                    }
                });

                if (!existingExam) {
                    const created = await tx.exam.create({
                        data: {
                            name: examTitle,
                            totalMarks: item.maxMarks,
                            subjectId: subjectObj.id,
                            examDate: eDate,
                            classId: Number(classId)
                        },
                        include: {
                            subject: true,
                            class: true
                        }
                    });
                    results.push(created);
                } else {
                    results.push(existingExam);
                }
            }
            return results;
        });

        void serverCache.clear();

    } catch (err) {
        console.log(err);
        return res.status(400).json({ message: "Error in creating the exam" });
    }
});
router.post("/release-exam", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isStaffRole(req.user.role)) {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const { examId, examName, classId, isReleased } = req.body;
        const releaseState = isReleased !== undefined ? Boolean(isReleased) : true;

        if (!examId && (!examName || !classId)) {
            return res.status(400).json({ message: "Missing required fields: examId or examName and classId" });
        }

        const authUserId = resolveAuthUserId(req.user);

        // Verification: If teacher, verify they are assigned as class teacher or teacher for this class
        if (req.user.role === "TEACHER") {
            const teacher = await prisma.teacher.findUnique({
                where: { userId: authUserId ?? -1 },
                select: { id: true }
            });
            if (!teacher) {
                return res.status(403).json({ message: "Teacher account not found" });
            }

            const targetClassId = Number(classId);
            if (targetClassId) {
                const cls = await prisma.class.findFirst({
                    where: {
                        id: targetClassId,
                        OR: [
                            { teacherId: teacher.id },
                            { teachers: { some: { teacherId: teacher.id } } }
                        ]
                    }
                });
                if (!cls) {
                    return res.status(403).json({ message: "You can only release marks for your assigned class" });
                }
            }
        }

        // Perform release update
        let updatedCount = 0;
        if (examId) {
            const updated = await prisma.exam.updateMany({
                where: { id: Number(examId) },
                data: { isReleased: releaseState }
            });
            updatedCount = updated.count;
        } else if (examName && classId) {
            const updated = await prisma.exam.updateMany({
                where: {
                    name: String(examName),
                    classId: Number(classId)
                },
                data: { isReleased: releaseState }
            });
            updatedCount = updated.count;
        }

        await logAudit({
            req,
            action: releaseState ? "RELEASE_EXAM_RESULTS" : "UNRELEASE_EXAM_RESULTS",
            tag: "EXAM" as any,
            details: `${releaseState ? 'Released' : 'Unreleased'} exam results (${examName || examId}) for Class ID #${classId}`,
            entityType: "Exam",
            entityId: String(examId || classId),
        });

        void serverCache.clear();

        return res.json({
            message: `Successfully ${releaseState ? 'released' : 'unreleased'} exam results for parents.`,
            isReleased: releaseState,
            updatedCount
        });
    } catch (err: any) {
        console.error("Error releasing exam:", err);
        return res.status(500).json({ message: "Error releasing exam results" });
    }
});


router.post("/create-marks", auth, async(req: AuthRequest, res: Response) => {
    try { 
        if (req.user.role !== "TEACHER" && req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "Unauthorized request"});
        }

        const {examId, marks, studentId} = req.body;

        if (examId === undefined || marks === undefined || studentId === undefined || marks === null || marks === '') {
            return res.status(400).json({message: "Missing required fields"});
        }

        const markNum = Number(marks);
        if (isNaN(markNum) || markNum < 0) {
            return res.status(400).json({message: "Marks must be a valid non-negative number"});
        }

        const exam = await prisma.exam.findUnique({
            where: { id: Number(examId) }
        });

        if (!exam) {
            return res.status(404).json({message: "Exam not found"});
        }

        if (markNum > exam.totalMarks) {
            return res.status(400).json({message: `Marks obtained (${markNum}) cannot exceed maximum marks (${exam.totalMarks})`});
        }

        const result = await prisma.mark.upsert({
            where: {
                examId_studentId: {
                    examId: Number(examId),
                    studentId: Number(studentId)
                }
            },
            update: {
                marks: markNum
            },
            create: {
                examId: Number(examId),
                marks: markNum,
                studentId: Number(studentId)
            }
        });

        void serverCache.clear();
        res.json({message: "Marks Created/Updated successfully!", data: result });
    } catch (err: any) {
        console.error("Error creating marks:", err);
        return res.status(400).json({message: err?.message || "Error creating marks details"});
    }
})

router.put("/update-class/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const {name, section, teacherId, teacherIds} = req.body;
        const classId = Number(req.params.id);

        const isclassexisted = await prisma.class.findUnique({
            where: {id: classId}
        });

        if (!isclassexisted) {
            return res.status(400).json({message: "Class not found"});
        }

        let targetTeacherIds: number[] = [];
        if (Array.isArray(teacherIds) && teacherIds.length > 0) {
            targetTeacherIds = teacherIds.map((id: any) => Number(id)).filter(Number.isFinite);
        } else if (teacherId !== undefined && teacherId !== null) {
            const primaryId = Number(teacherId);
            if (Number.isFinite(primaryId)) targetTeacherIds = [primaryId];
        }

        const primaryTeacherId = targetTeacherIds.length > 0 ? targetTeacherIds[0] : (teacherId !== undefined ? Number(teacherId) : isclassexisted.teacherId);

        const updatedClass = await prisma.$transaction(async (tx) => {
            // Delete existing teacher assignments for this class
            await tx.classTeacher.deleteMany({
                where: { classId }
            });

            // Create new teacher assignments
            if (targetTeacherIds.length > 0) {
                await tx.classTeacher.createMany({
                    data: targetTeacherIds.map((tId) => ({
                        classId,
                        teacherId: tId
                    }))
                });
            }

            return tx.class.update({
                where: { id: classId },
                data: {
                    name: name !== undefined ? name : isclassexisted.name,
                    section: section !== undefined ? section : isclassexisted.section,
                    teacherId: primaryTeacherId
                },
                include: {
                    teacher: true,
                    teachers: {
                        include: {
                            teacher: true
                        }
                    }
                }
            });
        });

        void serverCache.clear();

        void logAudit({
            req,
            action: "UPDATE_CLASS_ASSIGNMENTS",
            tag: "CLASS",
            details: `Updated teacher assignments for Class ${updatedClass.name} ${updatedClass.section}`,
            entityType: "Class",
            entityId: updatedClass.id,
        });

        res.json({message: "Class details updated successfully", data: updatedClass});
    } catch(err) {
        console.error("Error updating class details:", err);
        return res.status(400).json({message: "Error updating class details, Contact developer"});
    }
})


router.put("/update-marks/:id", auth, async (req: AuthRequest, res: Response) => {
  try {

    if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
      return res.status(403).json({ message: "Unauthorized request" });
    }

    const { examId, marks, studentId } = req.body;

    const marksId = Number(req.params.id);

    const existing = await prisma.mark.findUnique({
      where: { id: marksId }
    });

    if (!existing) {
      return res.status(404).json({ message: "Marks record not found" });
    }

    const updatedMarks = await prisma.mark.update({
      where: { id: marksId },
      data: {
        examId,
        marks,
        studentId
      },
      include: {
        student: true,
        exam: true
      }
    });

    res.json({message: "Successfully updated marks", data: updatedMarks});
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Error updating marks" });
  }
});

router.put("/update-subject/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const {name} = req.body;

        const subjectId = Number(req.params.id);

        const existing = await prisma.subject.findUnique({
            where: {id: subjectId},
        })
        
        if (!existing) {
            return res.status(400).json({message: "Subject not found"});
        }
        
        const updatedSubject = await prisma.subject.update({
            where: {id: subjectId},
            data: { name }
        })
        
        res.json({message: "Subject name updated successfully", data: updatedSubject})
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error updating the subject name, Contact developer"})
    }
})

router.put("/update-subject-classes/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const subjectId = Number(req.params.id);
        const { classIds } = req.body as { classIds?: number[] };

        if (!Array.isArray(classIds)) {
            return res.status(400).json({ message: "classIds must be an array" });
        }

        const subject = await prisma.subject.findUnique({
            where: { id: subjectId }
        });

        if (!subject) {
            return res.status(404).json({ message: "Subject not found" });
        }

        const normalizedClassIds = Array.from(new Set(classIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));

        if (normalizedClassIds.length > 0) {
            const existingClasses = await prisma.class.findMany({
                where: { id: { in: normalizedClassIds } },
                select: { id: true }
            });

            if (existingClasses.length !== normalizedClassIds.length) {
                return res.status(400).json({ message: "One or more classIds are invalid" });
            }
        }

        const currentMappings = await prisma.classSubject.findMany({
            where: { subjectId },
            select: { classId: true }
        });

        const currentClassIds = currentMappings.map((item) => item.classId);
        const toAdd = normalizedClassIds.filter((id) => !currentClassIds.includes(id));
        const toRemove = currentClassIds.filter((id) => !normalizedClassIds.includes(id));

        await prisma.$transaction(async (tx) => {
            if (toRemove.length > 0) {
                await tx.classSubject.deleteMany({
                    where: {
                        subjectId,
                        classId: { in: toRemove }
                    }
                });
            }

            if (toAdd.length > 0) {
                await tx.classSubject.createMany({
                    data: toAdd.map((classId) => ({
                        classId,
                        subjectId
                    })),
                    skipDuplicates: true
                });
            }
        });

        const updatedMappings = await prisma.classSubject.findMany({
            where: { subjectId },
            include: {
                class: true,
                subject: true
            }
        });

        return res.json({
            message: "Subject class mappings updated successfully",
            data: updatedMappings
        });
    } catch (err) {
        console.log(err);
        return res.status(400).json({ message: "Error updating subject class mappings, Contact developer" });
    }
});

router.delete("/delete-class/:id", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({ message: "UnAuthorized request" });
        }

        const classId = Number(req.params.id);
        if (!Number.isFinite(classId) || classId <= 0) {
            return res.status(400).json({ message: "Invalid class ID" });
        }

        const existingClass = await prisma.class.findUnique({
            where: { id: classId }
        });

        if (!existingClass) {
            return res.status(404).json({ message: "Class not found" });
        }

        await prisma.$transaction(async (tx) => {
            // Delete dependent records linked to the class
            await tx.classSubject.deleteMany({ where: { classId } });
            await tx.classTeacher.deleteMany({ where: { classId } });
            await tx.timeTable.deleteMany({ where: { classId } });

            // Delete exams & related marks for this class
            const classExams = await tx.exam.findMany({ where: { classId }, select: { id: true } });
            const examIds = classExams.map((e) => e.id);
            if (examIds.length > 0) {
                await tx.mark.deleteMany({ where: { examId: { in: examIds } } });
                await tx.exam.deleteMany({ where: { classId } });
            }

            // Delete attendance sessions & records for this class
            const sessions = await tx.attendanceSession.findMany({ where: { classId }, select: { id: true } });
            const sessionIds = sessions.map((s) => s.id);
            if (sessionIds.length > 0) {
                await tx.attendance.deleteMany({ where: { sessionId: { in: sessionIds } } });
                await tx.attendanceSession.deleteMany({ where: { classId } });
            }

            // Delete students belonging to this class (and their associated records)
            const classStudents = await tx.student.findMany({ where: { classId }, select: { id: true } });
            const studentIds = classStudents.map((s) => s.id);
            if (studentIds.length > 0) {
                await tx.parentStudent.deleteMany({ where: { studentId: { in: studentIds } } });
                await tx.fee.deleteMany({ where: { studentId: { in: studentIds } } });
                await tx.mark.deleteMany({ where: { studentId: { in: studentIds } } });
                await tx.attendance.deleteMany({ where: { studentId: { in: studentIds } } });
                await tx.student.deleteMany({ where: { classId } });
            }

            // Delete the class
            await tx.class.delete({ where: { id: classId } });
        });

        void serverCache.clear();

        void logAudit({
            req,
            action: "DELETE_CLASS",
            tag: "CLASS",
            details: `Deleted Class ${existingClass.name} ${existingClass.section}`,
            entityType: "Class",
            entityId: existingClass.id,
        });

        return res.json({ message: "Class deleted successfully" });
    } catch (err: any) {
        console.error("Error deleting class:", err);
        return res.status(400).json({ message: err?.message || "Failed to delete class" });
    }
});

router.put("/update-exam/:id", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const { name, totalMarks, subjectId, examDate, classId } = req.body;

        const examId = Number(req.params.id);

        const existing = await prisma.exam.findUnique({
            where: {id: examId}
        })

        if (!existing) {
            return res.status(400).json({message: "Exam not found"});
        }

        const updatedExam = await prisma.exam.update({
            where: {id: examId},
            data : {
                name,
                totalMarks,
                subjectId,
                examDate,
                classId
            },

            include : {
                subject: true,
                class: true
            }
        })

        res.json({message: "Succesfully updated exam details", data: updatedExam})
    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error updating exam details, Contact developer"})
    }
})


export default router;
