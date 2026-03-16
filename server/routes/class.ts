import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();


router.post("/create-class", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
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

        const {exam_name, totalMarks, subjectId, examDate, classId} = req.body;

        if (!exam_name || !totalMarks || !subjectId || !examDate || !classId) {
            return res.status(500).json({message : "Missing required fields"});
        }

        const existedExam = await prisma.exam.findUnique({
            where: {
                name_subjectId_classId: {
                    name: exam_name,
                    subjectId,
                    classId
                }
            }
        })

        if (existedExam) {
            return res.status(600).json({message: "Exam already existed try searching your exam."})
        }

        const result = await prisma.$transaction( async(tx) => {

            const exam = tx.exam.create({
                data: {
                    name: exam_name,
                    totalMarks,
                    subjectId,
                    examDate,
                    classId,  
                },

                include: {
                    subject: true,
                    class: true
                }
            })

            return exam;
        })

        res.json({message: "Exam created successfully", data: result})


    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error in creating the class"});
    }

})


router.post("/create-marks", auth, async(req: AuthRequest, res: Response) => {
    try { 
        if (req.user.role !== "TEACHER" && req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "Unauthorized request"})
        }

        const {examId, marks, studentId} = req.body;

        if (!examId || !marks || !studentId) {
            return res.status(500).json({message: "Missing required fields"});
        }

        const result = await prisma.mark.upsert({
            where: {
                examId_studentId: {
                    examId,
                    studentId
                }
            },
            update: {
                marks
            },
            create: {
                examId,
                marks,
                studentId
            }
        })


        res.json({message: "Marks Created/Updated successfully!", data: result })
    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error creating marks details, Contact developer"});
    }
})

router.put("/update-class/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if ((req.user.role) !== "PRINCIPAL" &&  req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const {name, section, teacherId} = req.body;

        const classId = Number(req.params.id);

        const isclassexisted = await prisma.class.findUnique({
            where: {id: classId}
        }) 

        if (!isclassexisted) {
            return res.status(400).json({message: "Class not found"});
        }

        const class_ = await prisma.class.update({
            where: {id: classId},
            data: {
                name,
                section,
                teacherId   
            }
        })


        res.json({message: "Class details updated successfully", data: class_});
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error updating class details, Contact developer"})
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

router.put("/update-exam/:id", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const {name}= req.body;

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