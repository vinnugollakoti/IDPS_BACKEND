import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { serverCache } from "../utils/cache";
import { logAudit } from "../utils/audit";
const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};

const resolveParentType = (relation?: string | null) => {
    const value = String(relation ?? "").toUpperCase();
    if (value === "MOTHER") return "MOTHER";
    if (value === "FATHER") return "FATHER";
    return "GUARDIAN";
};

router.post("/create-parent", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized request"});
        }

        const { email, gender, name, relation, phone1, phone2, type, studentId } = req.body;

        if (!name || !phone1) {
            return res.status(400).json({message: "Missing required fields: name and phone1 are required"});
        }

        const parentEmail = email && String(email).trim()
            ? String(email).trim().toLowerCase()
            : `parent.${phone1.replace(/\D/g, '')}.${Date.now()}@idps.local`;

        const existing = await prisma.user.findUnique({
            where: { email: parentEmail }
        });

        if (existing) {
            return res.status(400).json({message: "User already exists with this email"});
        }

        const relValue: any = relation === 'Father' ? 'Father' : (relation === 'Mother' ? 'Mother' : 'Guardian');
        const parentTypeVal: any = relation === 'Father' ? 'FATHER' : (relation === 'Mother' ? 'MOTHER' : 'GUARDIAN');
        const userGender: any = gender === 'FEMALE' || relation === 'Mother' ? 'FEMALE' : 'MALE';

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    name: name.trim(),
                    email: parentEmail,
                    role: "PARENT",
                    gender: userGender
                }
            });

            const parent = await tx.parent.create({
                data: {
                    name: name.trim(),
                    relation: relValue,
                    type: parentTypeVal,
                    phone1: String(phone1).trim(),
                    phone2: phone2 ? String(phone2).trim() : null,
                    userId: user.id
                }
            });

            if (studentId) {
                const sId = Number(studentId);
                if (Number.isFinite(sId)) {
                    await tx.parentStudent.create({
                        data: {
                            parentId: parent.id,
                            studentId: sId
                        }
                    }).catch(() => {});
                }
            }

            return { user, parent };
        });

        void serverCache.clear();
        res.json({ message: "Parent created successfully", data: result });
        
    } catch (err: any) {
        console.error("Error in /create-parent:", err);
        res.status(500).json({ message: err?.message || "Failed to create parent" });
    }
});

import { uploadUserProfilePhoto } from "../lib/supabaseStorage";

router.post("/create-teacher", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized area"});
        }

        const {name, email, phone, gender, photo, photoBase64, photoMimeType} = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({message : "Missing required fields: name, email, and phone are required"});
        }

        const teacherEmail = String(email).trim().toLowerCase();
        const existing = await prisma.user.findUnique({
            where : { email: teacherEmail }
        });

        if (existing) {
            return res.status(400).json({message : "User with this email already exists"});
        }

        const tGender: any = gender === 'FEMALE' ? 'FEMALE' : 'MALE';
        let photoUrl: string | null = photo && typeof photo === 'string' && photo.startsWith('http') ? photo : null;

        if (!photoUrl && photoBase64) {
            try {
                const uploaded = await uploadUserProfilePhoto({
                    imageBase64: photoBase64,
                    imageMimeType: photoMimeType || 'image/jpeg',
                    path: `teachers/teacher_${Date.now()}`
                });
                photoUrl = uploaded.imageUrl;
            } catch (uploadErr) {
                console.error("Failed to upload teacher profile photo to Supabase:", uploadErr);
            }
        }

        const result = await prisma.$transaction( async (tx) => {
            const user = await tx.user.create({
                data : {
                    name: name.trim(),
                    email: teacherEmail,
                    role: "TEACHER",
                    gender: tGender
                }
            });

            const teacher = await tx.teacher.create({
                data : {
                    name: name.trim(),
                    photo: photoUrl,
                    phone: String(phone).trim(),
                    gender: tGender,
                    userId: user.id
                }
            });

            return {user, teacher};
        });

        void serverCache.clear();

        void logAudit({
            req,
            action: "CREATE_TEACHER",
            tag: "AUTH",
            details: `Created Teacher ${name.trim()} (${teacherEmail})`,
            entityType: "Teacher",
            entityId: result.teacher.id,
        });

        res.json({message : "Teacher created successfully", data: result});
    } catch(err: any) {
        console.error("Error creating teacher:", err);
        res.status(500).json({message : err?.message || "Failed to create teacher"});
    }
});

router.delete("/delete-teacher/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message : "UnAuthorized area"});
        }

        const teacherId = Number(req.params.id);
        if (!Number.isFinite(teacherId) || teacherId <= 0) {
            return res.status(400).json({message: "Invalid teacher ID"});
        }

        const teacher = await prisma.teacher.findUnique({
            where: { id: teacherId }
        });

        if (!teacher) {
            return res.status(404).json({message: "Teacher not found"});
        }

        await prisma.$transaction(async (tx) => {
            // Unlink class assignments
            await tx.classTeacher.deleteMany({ where: { teacherId } });
            await tx.class.updateMany({
                where: { teacherId },
                data: { teacherId: null }
            });
            // Unlink timetable entries
            await tx.timeTable.deleteMany({ where: { teacherId } });
            // Delete teacher record & user profile
            await tx.teacher.delete({ where: { id: teacherId } });
            await tx.user.delete({ where: { id: teacher.userId } }).catch(() => {});
        });

        void serverCache.clear();

        void logAudit({
            req,
            action: "DELETE_TEACHER",
            tag: "AUTH",
            details: `Deleted Teacher ${teacher.name}`,
            entityType: "Teacher",
            entityId: teacher.id,
        });

        res.json({message: "Teacher deleted successfully"});
    } catch(err: any) {
        console.error("Error deleting teacher:", err);
        res.status(500).json({message: err?.message || "Failed to delete teacher"});
    }
});


const mapMotherTongue = (value?: string | null) => {
    if (!value) return null;
    const text = String(value).trim().toUpperCase();
    if (text.includes("TELUGU")) return "TELUGU";
    if (text.includes("URDU") || text.includes("URGU")) return "URGU";
    if (text.includes("ENGLISH")) return "ENGLISH";
    return "TELUGU";
};

const mapBloodGroup = (value?: string | null) => {
    if (!value) return null;
    const text = String(value).trim().toUpperCase();
    if (text === "A+" || text === "A_POS") return "A_POS";
    if (text === "A-" || text === "A_NEG") return "A_NEG";
    if (text === "B+" || text === "B_POS") return "B_POS";
    if (text === "B-" || text === "B_NEG") return "B_NEG";
    if (text === "AB+" || text === "AB_POS") return "AB_POS";
    if (text === "AB-" || text === "AB_NEG") return "AB_NEG";
    if (text === "O+" || text === "O_POS") return "O_POS";
    if (text === "O-" || text === "O_NEG") return "O_NEG";
    return null;
};

const mapSocialCategory = (value?: string | null) => {
    if (!value) return null;
    const text = String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (["OC", "GENERAL"].includes(text)) return "OC";
    if (["BCA", "BC_A"].includes(text)) return "BC_A";
    if (["BCB", "BC_B"].includes(text)) return "BC_B";
    if (["BCC", "BC_C"].includes(text)) return "BC_C";
    if (["BCD", "BC_D"].includes(text)) return "BC_D";
    if (["BCE", "BC_E"].includes(text)) return "BC_E";
    if (["SC"].includes(text)) return "SC";
    if (["ST"].includes(text)) return "ST";
    return null;
};

router.post("/create-student", auth, async( req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "UnAuthorized area"});
        }

        const { photo, name, gender, dob, classId, busId, parentIds, admissionno, adharnumber, mothertongue, socialcategory, bloodgroup, address } = req.body;

        if (!name || !gender || !classId) {
            return res.status(400).json({message: "Missing required fields: name, gender, and classId are required"});
        }

        let parentConnectArray: any[] = [];
        if (Array.isArray(parentIds) && parentIds.length > 0) {
            const parents = await prisma.parent.findMany({
                where: { id: { in: parentIds.map((id: any) => Number(id)) } }
            });

            if (parents.length > 0) {
                parentConnectArray = parents.map((p) => ({
                    parent: { connect: { id: p.id } }
                }));
            }
        }

        let student = await prisma.student.create({
            data: {
                photo,
                name: name.trim(),
                gender,
                dob: dob ? new Date(dob) : null,
                classId: Number(classId),
                busId: busId ? Number(busId) : null,
                admissionno: admissionno || `ADM-${Date.now().toString().slice(-4)}`,
                adharnumber: adharnumber ? String(adharnumber).replace(/\D/g, '').slice(0, 12) : null,
                mothertongue: mapMotherTongue(mothertongue),
                socialcategory: mapSocialCategory(socialcategory),
                bloodgroup: mapBloodGroup(bloodgroup),
                address: address || null,
                parents: parentConnectArray.length > 0 ? { create: parentConnectArray } : undefined
            },
            include: {
                parents: {
                    include: {
                        parent: true
                    }
                },
                feeDetails: true,
                marks: true,
                attendances: true,
                class: true,
                bus: true
            }
        });
        student = await prisma.student.update({ where: { id: student.id }, data: { studentCode: `S-${String(student.id).padStart(3, '0')}` }, include: { parents: { include: { parent: true } }, feeDetails: true, marks: true, attendances: true, class: true, bus: true } });

        void serverCache.clear();
        
        res.json({message: "Student created successfully", data: student, student});

    } catch(err: any) {
        console.error("Error in /create-student:", err);
        res.status(500).json({message: err?.message || "Failed to create student"});
    }
})

router.get("/me", auth, async (req: AuthRequest, res: Response) => {
   const authUserId = resolveAuthUserId(req.user);
   if (!authUserId) {
      return res.status(401).json({ message: "Invalid token payload" });
   }

   const user = await prisma.user.findUnique({
      where: { id: authUserId },
      include: {
        parent: true,
        teacher: true
      }
   });

   if (!user) {
      return res.status(404).json({ message: "User not found" });
   }

   const { otp: _uOtp, otpExpiry: _uExp, ...safeUser } = user;
   const phone = user.teacher?.phone || user.parent?.phone1 || undefined;
   res.json({ message: "User profile fetched", data: { ...safeUser, phone }, user: { ...safeUser, phone } });
});

router.put("/me", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) return res.status(401).json({ message: "Invalid token payload" });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    if (!name || !email) return res.status(400).json({ message: "Name and email are required" });
    
    const existing = await prisma.user.findFirst({ where: { email, NOT: { id: userId } } });
    if (existing) return res.status(409).json({ message: "Another account already uses this email" });

    const user = await prisma.user.update({ 
      where: { id: userId }, 
      data: { name, email }, 
      include: { teacher: true, parent: true } 
    });

    if (user.teacher) {
      await prisma.teacher.update({ 
        where: { id: user.teacher.id }, 
        data: { name, ...(phone ? { phone } : {}) } 
      });
    }

    if (user.parent) {
      await prisma.parent.update({ 
        where: { id: user.parent.id }, 
        data: { name, ...(phone ? { phone1: phone } : {}) } 
      });
    }

    serverCache.clear();

    const safeUser = { ...user, phone: phone || user.teacher?.phone || user.parent?.phone1 || undefined };
    delete (safeUser as any).otp;
    delete (safeUser as any).otpExpiry;
    res.json({ message: "Profile updated successfully", data: safeUser, user: safeUser });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to update profile", error: err?.message });
  }
});

router.delete("/me", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    if (!userId) return res.status(401).json({ message: "Invalid token payload" });
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { teacher: true, parent: true } });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "CHAIRMAN" || user.role === "DIRECTOR") return res.status(403).json({ message: "Executive accounts must be deleted by an administrator" });
    await prisma.$transaction(async (tx) => {
      if (user.teacher) await tx.teacher.delete({ where: { id: user.teacher.id } }).catch(() => {});
      if (user.parent) await tx.parent.delete({ where: { id: user.parent.id } }).catch(() => {});
      await tx.user.delete({ where: { id: userId } });
    });
    serverCache.clear();
    res.json({ message: "Account deleted" });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to delete account", error: err?.message });
  }
});

router.post("/me/photo", auth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = resolveAuthUserId(req.user);
    const photoBase64 = typeof req.body?.photoBase64 === "string" ? req.body.photoBase64 : "";
    if (!userId || !photoBase64) return res.status(400).json({ message: "A profile image is required" });
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { teacher: true, parent: true } });
    if (!user) return res.status(404).json({ message: "User not found" });
    
    const uploaded = await uploadUserProfilePhoto({ 
      imageBase64: photoBase64, 
      imageMimeType: req.body?.photoMimeType || "image/jpeg", 
      path: `users/user_${userId}_${Date.now()}` 
    });

    await prisma.user.update({ where: { id: userId }, data: { photoUrl: uploaded.imageUrl } });
    if (user.teacher) await prisma.teacher.update({ where: { id: user.teacher.id }, data: { photo: uploaded.imageUrl } });
    
    serverCache.clear();
    res.json({ message: "Profile photo updated", data: { photoUrl: uploaded.imageUrl }, photoUrl: uploaded.imageUrl });
  } catch (error: any) { 
    console.error("[/me/photo error]:", error);
    res.status(500).json({ message: "Failed to upload profile photo", error: error?.message }); 
  }
});


router.put("/update-parent/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "TEACHER" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "UnAuthorized request"})
        }

        const parentId = Number(req.params.id);

        const {name, email, gender, relation, phone1, phone2, type} = req.body;

        const parent = await prisma.parent.findUnique({
            where: {id: parentId}
        });

        if (!parent) {
            return res.status(400).json({message: "Parent profile not existed"});
        }

        const result = await prisma.$transaction(async (tx) => {
            if (email) {
                await tx.user.update({
                    where: {id: parent.userId},
                    data: {email, name, gender}
                })
            }

            const updatedParent = await tx.parent.update({
                where: {id: parentId},
                data: {
                    name,
                    relation,
                    phone1,
                    phone2,
                }
            })

            return updatedParent;
        })

        res.json({message: "Parent details updated successfully", data: result})

    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error in updating the details, Contact developer"})
    }
})


router.put("/update-student/:id", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "TEACHER" && req.user.role !== "RECEPTIONIST") {
            return res.status(400).json({message: "UnAuthorized request"})
        }

        const {photo, name, gender, dob, classId, busId} = req.body;
        const studentId = Number(req.params.id);

        const student = await prisma.student.update({
            where: {id: studentId},
            data: {
                photo,
                name,
                gender,
                dob,
                classId,
                busId
            },

            include: {
                parents: {include: {parent: true}},
                class: true,
                bus: true
            }
        })

        res.json({message: "Student details updated successfully", data: student});

    } catch (err) {
        console.log(err)
        return res.status(400).json({message: "Error in updating student details, Contact developer"});
    }
})


router.put("/update-teacher/:id", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (
            !isExecutiveRole(req.user.role) &&
            req.user.role !== "RECEPTIONIST"
        ) {
            return res.status(400).json({ message: "UnAuthorized request" });
        }

        const { name, email, phone, gender, salary, photo, photoBase64, photoMimeType } = req.body;
        const teacherId = Number(req.params.id);

        const teacher = await prisma.teacher.findUnique({
            where: { id: teacherId },
            include: { user: true }
        });

        if (!teacher) {
            return res.status(400).json({ message: "Teacher not found" });
        }

        let photoUrl: string | undefined = photo && typeof photo === 'string' && photo.startsWith('http') ? photo : undefined;

        if (!photoUrl && photoBase64) {
            try {
                const uploaded = await uploadUserProfilePhoto({
                    imageBase64: photoBase64,
                    imageMimeType: photoMimeType || 'image/jpeg',
                    path: `teachers/teacher_${teacherId}_${Date.now()}`
                });
                photoUrl = uploaded.imageUrl;
            } catch (uploadErr) {
                console.error("Failed to upload teacher profile photo to Supabase:", uploadErr);
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            if (email) {
                const existingUser = await tx.user.findUnique({
                    where: { email }
                });

                if (existingUser && existingUser.id !== teacher.userId) {
                    throw new Error("Email already in use");
                }
            }

            if (email || name) {
                await tx.user.update({
                    where: { id: teacher.userId },
                    data: {
                        ...(email && { email }),
                        ...(name && { name })
                    }
                });
            }

            const updatedTeacher = await tx.teacher.update({
                where: { id: teacherId },
                data: {
                    ...(name && { name }),
                    ...(phone && { phone }),
                    ...(gender && { gender }),
                    ...(salary && { salary }),
                    ...(photoUrl && { photo: photoUrl })
                }
            });

            return updatedTeacher;
        });

        return res.json({
            message: "Teacher details updated successfully",
            data: result
        });

    } catch (err: any) {
        console.log(err);

        if (err.message === "Email already in use") {
            return res.status(400).json({ message: err.message });
        }

        return res.status(400).json({
            message: "Failed to update teacher details"
        });
    }
});
export default router;
