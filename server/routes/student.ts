import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth } from "../middleware/auth";
const router = express.Router();

const resolveAuthUserId = (user: any) => {
    const value = Number(user?.userId ?? user?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
};

type ImportParentInput = {
    name?: string | null;
    phone?: string | null;
    aadhar?: string | null;
    qualification?: string | null;
    relation?: "Father" | "Mother" | "Guardian" | null;
};

type ImportStudentInput = {
    rowNumber?: number;
    admissionno?: string | null;
    name?: string | null;
    gender?: string | null;
    dob?: string | null;
    adharnumber?: string | null;
    pincode?: string | null;
    mothertongue?: string | null;
    socialcategory?: string | null;
    bloodgroup?: string | null;
    admissiondate?: string | null;
    height?: number | string | null;
    weight?: number | string | null;
    address?: string | null;
    parents?: {
        father?: ImportParentInput | null;
        mother?: ImportParentInput | null;
    } | null;
    fatherName?: string | null;
    motherName?: string | null;
    mobileNumber?: string | null;
    fatherAadhar?: string | null;
    motherAadhar?: string | null;
    qualification?: string | null;
};

type ImportBatchResult = {
    createdStudents: number;
    createdParents: number;
    createdMothers: number;
    createdFathers: number;
    linkedParents: number;
    linkedRelations: number;
    reusedParents: number;
    skippedRows: number;
    failedRows: Array<{
        rowNumber: number;
        admissionno?: string | null;
        name?: string | null;
        step?: string;
        errors: string[];
    }>;
    createdStudentIds: number[];
};

type ImportStepTrace = {
    rowNumber: number;
    admissionno?: string | null;
    name?: string | null;
    step: "validation" | "parent" | "student" | "relation" | "transaction";
    message: string;
};

const normalizeText = (value?: string | null) => {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return text.length ? text : "";
};

const normalizeDigits = (value?: string | number | null) => {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).replace(/\D+/g, "");
};

const normalizeGender = (value?: string | null) => {
    const text = normalizeText(value).toUpperCase();
    if (["M", "MALE", "BOY"].includes(text)) return "MALE";
    if (["F", "FEMALE", "GIRL"].includes(text)) return "FEMALE";
    return null;
};

const normalizeMotherTongue = (value?: string | null) => {
    const text = normalizeText(value).toUpperCase().replace(/[^A-Z]/g, "");
    if (!text) return null;
    if (["TELUGU"].includes(text)) return "TELUGU";
    if (["URDU", "URGU"].includes(text)) return "URGU";
    if (["ENGLISH"].includes(text)) return "ENGLISH";
    return null;
};

const normalizeSocialCategory = (value?: string | null) => {
    const text = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!text) return null;
    if (["OC", "GENERAL", "OPENCATEGORY"].includes(text)) return "OC";
    if (["BCA", "BCA"].includes(text)) return "BC_A";
    if (["BCB"].includes(text)) return "BC_B";
    if (["BCC"].includes(text)) return "BC_C";
    if (["BCD"].includes(text)) return "BC_D";
    if (["BCE"].includes(text)) return "BC_E";
    if (["MBCDNC", "MBC", "MBCD"].includes(text)) return "MBC_DNC";
    if (["SC", "SCHEDULEDCASTE"].includes(text)) return "SC";
    if (["ST", "SCHEDULEDTRIBE"].includes(text)) return "ST";
    return null;
};

const normalizeBloodGroup = (value?: string | null) => {
    const text = normalizeText(value).toUpperCase().replace(/[^A-Z0-9+]/g, "");
    if (!text) return null;
    const map: Record<string, string> = {
        "A+": "A_POS",
        "A+VE": "A_POS",
        "APOS": "A_POS",
        "A-": "A_NEG",
        "A-VE": "A_NEG",
        "ANEG": "A_NEG",
        "B+": "B_POS",
        "B+VE": "B_POS",
        "BPOS": "B_POS",
        "B-": "B_NEG",
        "B-VE": "B_NEG",
        "BNEG": "B_NEG",
        "AB+": "AB_POS",
        "AB+VE": "AB_POS",
        "ABPOS": "AB_POS",
        "AB-": "AB_NEG",
        "AB-VE": "AB_NEG",
        "ABNEG": "AB_NEG",
        "O+": "O_POS",
        "O+VE": "O_POS",
        "OPOS": "O_POS",
        "O-": "O_NEG",
        "O-VE": "O_NEG",
        "ONEG": "O_NEG",
    };

    return map[text] ?? null;
};

const normalizeQualification = (value?: string | null) => {
    const text = normalizeText(value).toUpperCase().replace(/[\s.]/g, "");
    if (!text) return null;
    const map: Record<string, string> = {
        NOFORMALEDUCATION: "NO_FORMAL_EDUCATION",
        PRIMARY: "PRIMARY",
        MIDDLESCHOOL: "MIDDLE_SCHOOL",
        SECONDARY: "SECONDARY",
        HIGHERSECONDARY: "HIGHER_SECONDARY",
        DIPLOMA: "DIPLOMA",
        ITI: "ITI",
        BSC: "BSC",
        BCOM: "BCOM",
        BA: "BA",
        BTECH: "BTECH",
        BE: "BE",
        BBA: "BBA",
        BCA: "BCA",
        BDS: "BDS",
        MBBS: "MBBS",
        MSC: "MSC",
        MCOM: "MCOM",
        MA: "MA",
        MTECH: "MTECH",
        MBA: "MBA",
        MCA: "MCA",
        PHD: "PHD",
        OTHER: "OTHER",
    };
    return map[text] ?? "OTHER";
};

const parseFlexibleDate = (value?: string | null) => {
    const text = normalizeText(value);
    if (!text) return null;

    const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
    if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const slashMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (slashMatch) {
        const first = Number(slashMatch[1]);
        const second = Number(slashMatch[2]);
        let year = Number(slashMatch[3]);
        if (year < 100) {
            year += year > 50 ? 1900 : 2000;
        }

        let day = first;
        let month = second;
        if (first <= 12 && second > 12) {
            day = second;
            month = first;
        }
        const date = new Date(Date.UTC(year, month - 1, day));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseIntegerLike = (value?: string | number | null) => {
    if (value === null || value === undefined) return null;
    const match = String(value).match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const numberValue = Math.floor(Number(match[0]));
    return Number.isFinite(numberValue) ? numberValue : null;
};

const buildImportEmail = async (seed: string, role: string, tx: any) => {
    const safeSeed = normalizeDigits(seed) || normalizeText(seed).toLowerCase().replace(/[^a-z0-9]+/g, ".");
    const base = safeSeed || `row.${Date.now()}`;
    let suffix = 0;

    while (suffix < 10) {
        const email = `${role.toLowerCase()}.${base}${suffix ? `.${suffix}` : ""}@idps.import.local`;
        const existing = await tx.user.findUnique({ where: { email } });
        if (!existing) {
            return email;
        }
        suffix += 1;
    }

    return `${role.toLowerCase()}.${base}.${Date.now()}@idps.import.local`;
};

const resolveParentType = (relation: "Father" | "Mother" | "Guardian") => {
    if (relation === "Mother") return "MOTHER";
    if (relation === "Father") return "FATHER";
    return "GUARDIAN";
};

const importParent = async (
    tx: any,
    parent: ImportParentInput | null | undefined,
    relation: "Father" | "Mother" | "Guardian",
): Promise<{ parentId: number; created: boolean; type: "MOTHER" | "FATHER" | "GUARDIAN"; matchedBy: "aadhar" | "phone" | "name" | "none" } | null> => {
    const name = normalizeText(parent?.name);
    const phone1 = normalizeDigits(parent?.phone);
    const adharnumber = normalizeDigits(parent?.aadhar);
    const qualification = normalizeQualification(parent?.qualification);
    const relationValue = relation;
    const typeValue = resolveParentType(relation);

    if (!name && !phone1 && !adharnumber) {
        return null;
    }

    const existingByAadhar = adharnumber
        ? await tx.parent.findFirst({
            where: {
                adharnumber,
                relation: relationValue,
            },
        })
        : null;
    const existingByPhone = !existingByAadhar && phone1
          ? await tx.parent.findFirst({
              where: {
                  phone1,
                  relation: relationValue,
              },
          })
          : null;
    const existingByName = !existingByAadhar && !existingByPhone
        ? await tx.parent.findFirst({
            where: {
                name: name || undefined,
                relation: relationValue,
            },
        })
        : null;

    const existing = existingByAadhar ?? existingByPhone ?? existingByName;

    if (existing) {
        const updated = await tx.parent.update({
            where: { id: existing.id },
            data: {
                name: name || existing.name,
                relation: relationValue ?? existing.relation ?? undefined,
                phone1: phone1 || existing.phone1,
                adharnumber: adharnumber || existing.adharnumber,
                qualification: qualification ?? existing.qualification ?? undefined,
            },
        });

        return {
            parentId: updated.id,
            created: false,
            type: typeValue,
            matchedBy: existingByAadhar ? "aadhar" : existingByPhone ? "phone" : "name",
        };
    }

    const gender = relationValue === "Mother" ? "FEMALE" : "MALE";
    const emailSeed = adharnumber || phone1 || name || `parent-${Date.now()}`;
    const user = await tx.user.create({
        data: {
            name: name || `Parent ${Date.now()}`,
            email: await buildImportEmail(emailSeed, "parent", tx),
            role: "PARENT",
            gender,
        },
    });

    const createdParent = await tx.parent.create({
        data: {
            name: name || user.name,
            relation: relationValue,
            phone1: phone1 || "0000000000",
            phone2: null,
            qualification,
            adharnumber: adharnumber || null,
            userId: user.id,
        },
    });

    return { parentId: createdParent.id, created: true, type: typeValue, matchedBy: "none" };
};

const normalizeImportRow = (row: ImportStudentInput, classId: number, rowNumber: number) => {
    const admissionno = normalizeText(row.admissionno) || `TEMP-${classId}-${rowNumber}`;
    const name = normalizeText(row.name);
    const gender = normalizeGender(row.gender);
    const dob = parseFlexibleDate(row.dob);
    const adharnumber = normalizeDigits(row.adharnumber);
    const pincode = normalizeDigits(row.pincode);
    const mothertongue = normalizeMotherTongue(row.mothertongue);
    const socialcategory = normalizeSocialCategory(row.socialcategory);
    const bloodgroup = normalizeBloodGroup(row.bloodgroup);
    const admissiondate = parseFlexibleDate(row.admissiondate);
    const height = parseIntegerLike(row.height);
    const weight = parseIntegerLike(row.weight);
    const address = normalizeText(row.address);

    const errors: string[] = [];
    if (!name) errors.push("Missing student name");
    if (!gender) errors.push("Missing or invalid gender");
    if (!classId || Number.isNaN(classId)) errors.push("Missing classId");

    const fatherName = normalizeText(row.parents?.father?.name ?? row.fatherName);
    const motherName = normalizeText(row.parents?.mother?.name ?? row.motherName);
    const sharedPhone = normalizeDigits(row.parents?.father?.phone ?? row.parents?.mother?.phone ?? row.mobileNumber);
    const fatherPhone = normalizeDigits(row.parents?.father?.phone ?? row.mobileNumber);
    const motherPhone = normalizeDigits(row.parents?.mother?.phone ?? row.mobileNumber);
    const fatherAadhar = normalizeDigits(row.parents?.father?.aadhar ?? row.fatherAadhar);
    const motherAadhar = normalizeDigits(row.parents?.mother?.aadhar ?? row.motherAadhar);
    const qualification = normalizeQualification(row.parents?.father?.qualification ?? row.parents?.mother?.qualification ?? row.qualification);

    return {
        rowNumber,
        admissionno,
        name,
        gender,
        dob,
        adharnumber: adharnumber || null,
        pincode: pincode || null,
        mothertongue,
        socialcategory,
        bloodgroup,
        admissiondate,
        height,
        weight,
        address: address || null,
        parents: {
            father: fatherName || fatherPhone || fatherAadhar
                ? {
                      name: fatherName,
                      phone: fatherPhone || sharedPhone || null,
                      aadhar: fatherAadhar || null,
                      qualification: qualification ?? null,
                      relation: "Father",
                  }
                : null,
            mother: motherName || motherPhone || motherAadhar
                ? {
                      name: motherName,
                      phone: motherPhone || sharedPhone || null,
                      aadhar: motherAadhar || null,
                      qualification: qualification ?? null,
                      relation: "Mother",
                  }
                : null,
        },
        errors,
    };
};

const importStudentRow = async (
    row: ReturnType<typeof normalizeImportRow>,
    classId: number,
) => {
    const result: ImportBatchResult = {
        createdStudents: 0,
        createdParents: 0,
        createdMothers: 0,
        createdFathers: 0,
        linkedParents: 0,
        linkedRelations: 0,
        reusedParents: 0,
        skippedRows: 0,
        failedRows: [],
        createdStudentIds: [],
    };

    if (row.errors.length) {
        result.failedRows.push({
            rowNumber: row.rowNumber,
            admissionno: row.admissionno,
            name: row.name,
            step: "validation",
            errors: row.errors,
        });
        result.skippedRows += 1;
        return result;
    }

    try {
        console.log("[student-import] executing row", {
            rowNumber: row.rowNumber,
            admissionno: row.admissionno,
            name: row.name,
            hasFather: Boolean(row.parents?.father?.name || row.parents?.father?.phone || row.parents?.father?.aadhar),
            hasMother: Boolean(row.parents?.mother?.name || row.parents?.mother?.phone || row.parents?.mother?.aadhar),
        });

        const rowResult = await prisma.$transaction(async (tx) => {
            const duplicate = await tx.student.findFirst({
                where: {
                    classId,
                    admissionno: row.admissionno,
                },
            });

            if (duplicate) {
                throw new Error("Student with the same admission number already exists in this class");
            }

            const parentInputs: Array<{ relation: "Father" | "Mother" | "Guardian"; payload: ImportParentInput | null | undefined }> = [
                { relation: "Father", payload: row.parents?.father },
                { relation: "Mother", payload: row.parents?.mother },
            ];

            const linkedParentIds: number[] = [];
            let createdParents = 0;
            let createdMothers = 0;
            let createdFathers = 0;
            let reusedParents = 0;

            console.log("[student-import] row start", {
                rowNumber: row.rowNumber,
                admissionno: row.admissionno,
                name: row.name,
                classId,
            });

            for (const parentInput of parentInputs) {
                const hasParentData =
                    normalizeText(parentInput.payload?.name) ||
                    normalizeDigits(parentInput.payload?.phone) ||
                    normalizeDigits(parentInput.payload?.aadhar);

                if (!hasParentData) {
                    console.log("[student-import] parent skipped (no data)", {
                        rowNumber: row.rowNumber,
                        relation: parentInput.relation,
                    });
                    continue;
                }

                const parentResult = await importParent(tx, parentInput.payload, parentInput.relation);
                if (!parentResult) {
                    throw new Error(`Failed to create or reuse ${parentInput.relation.toLowerCase()} parent`);
                }

                linkedParentIds.push(parentResult.parentId);
                if (parentResult.created) {
                    createdParents += 1;
                    if (parentResult.type === "MOTHER") createdMothers += 1;
                    if (parentResult.type === "FATHER") createdFathers += 1;
                } else {
                    reusedParents += 1;
                }

                console.log("[student-import] parent resolved", {
                    rowNumber: row.rowNumber,
                    relation: parentInput.relation,
                    parentId: parentResult.parentId,
                    created: parentResult.created,
                    matchedBy: parentResult.matchedBy,
                });
            }

            const student = await tx.student.create({
                data: {
                    admissionno: row.admissionno,
                    name: row.name,
                    gender: row.gender,
                    dob: row.dob ?? undefined,
                    adharnumber: row.adharnumber || undefined,
                    pincode: row.pincode || undefined,
                    mothertongue: row.mothertongue ?? undefined,
                    socialcategory: row.socialcategory ?? undefined,
                    bloodgroup: row.bloodgroup ?? undefined,
                    admissiondate: row.admissiondate ?? undefined,
                    height: row.height ?? undefined,
                    weight: row.weight ?? undefined,
                    address: row.address ?? undefined,
                    classId,
                },
            });

            console.log("[student-import] student created", {
                rowNumber: row.rowNumber,
                studentId: student.id,
                admissionno: row.admissionno,
            });

            const uniqueParentIds = [...new Set(linkedParentIds)];
            if (uniqueParentIds.length) {
                const relationResult = await tx.parentStudent.createMany({
                    data: uniqueParentIds.map((parentId) => ({
                        parentId,
                        studentId: student.id,
                    })),
                    skipDuplicates: true,
                });
                if (relationResult.count !== uniqueParentIds.length) {
                    console.log("[student-import] some parent relations were skipped or already existed", {
                        rowNumber: row.rowNumber,
                        studentId: student.id,
                        attempted: uniqueParentIds.length,
                        created: relationResult.count,
                    });
                }
                console.log("[student-import] relations linked", {
                    rowNumber: row.rowNumber,
                    studentId: student.id,
                    parentIds: uniqueParentIds,
                    created: relationResult.count,
                });
            } else {
                console.log("[student-import] no parents linked", {
                    rowNumber: row.rowNumber,
                    studentId: student.id,
                });
            }

            return {
                createdStudents: 1,
                createdParents,
                createdMothers,
                createdFathers,
                linkedParents: uniqueParentIds.length,
                linkedRelations: uniqueParentIds.length,
                reusedParents,
                studentId: student.id,
                parentIds: uniqueParentIds,
            };
        });

        result.createdStudents = rowResult.createdStudents;
        result.createdParents = rowResult.createdParents;
        result.createdMothers = rowResult.createdMothers;
        result.createdFathers = rowResult.createdFathers;
        result.linkedParents = rowResult.linkedParents;
        result.linkedRelations = rowResult.linkedRelations;
        result.reusedParents = rowResult.reusedParents;
        result.createdStudentIds.push(rowResult.studentId);
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected database error while importing this row";
        console.log("[student-import] row failed", {
            rowNumber: row.rowNumber,
            admissionno: row.admissionno,
            name: row.name,
            error: message,
        });
        result.failedRows.push({
            rowNumber: row.rowNumber,
            admissionno: row.admissionno,
            name: row.name,
            step: "transaction",
            errors: [message],
        });
        result.skippedRows += 1;
        return result;
    }
};


router.post("/bulk-import-students", auth, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const classId = Number(req.body.classId);
        const rows = Array.isArray(req.body.rows) ? (req.body.rows as ImportStudentInput[]) : [];

        if (!Number.isFinite(classId) || classId <= 0) {
            return res.status(400).json({ message: "Valid classId is required" });
        }

        if (!rows.length) {
            return res.status(400).json({ message: "No rows received for import" });
        }

        const classExists = await prisma.class.findUnique({
            where: { id: classId },
            select: { id: true, name: true, section: true },
        });

        if (!classExists) {
            return res.status(404).json({ message: "Class not found for the provided classId" });
        }

        const normalizedRows = rows.map((row, index) => normalizeImportRow(row, classId, Number(row.rowNumber ?? index + 1)));
        const summary: ImportBatchResult = {
            createdStudents: 0,
            createdParents: 0,
            createdMothers: 0,
            createdFathers: 0,
            linkedParents: 0,
            linkedRelations: 0,
            reusedParents: 0,
            skippedRows: 0,
            failedRows: [],
            createdStudentIds: [],
        };
        const stepTrace: ImportStepTrace[] = [];

        for (const row of normalizedRows) {
            const rowResult = await importStudentRow(row, classId);
            summary.createdStudents += rowResult.createdStudents;
            summary.createdParents += rowResult.createdParents;
            summary.createdMothers += rowResult.createdMothers;
            summary.createdFathers += rowResult.createdFathers;
            summary.linkedParents += rowResult.linkedParents;
            summary.linkedRelations += rowResult.linkedRelations;
            summary.reusedParents += rowResult.reusedParents;
            summary.skippedRows += rowResult.skippedRows;
            summary.failedRows.push(...rowResult.failedRows);
            summary.createdStudentIds.push(...rowResult.createdStudentIds);

            for (const failedRow of rowResult.failedRows) {
                stepTrace.push({
                    rowNumber: failedRow.rowNumber,
                    admissionno: failedRow.admissionno ?? null,
                    name: failedRow.name ?? null,
                    step: (failedRow.step as ImportStepTrace["step"]) ?? "transaction",
                    message: failedRow.errors.join(" | "),
                });
            }
        }

        return res.json({
            message: "Import completed",
            data: {
                classId,
                className: `${classExists.name}-${classExists.section}`,
                ...summary,
                stepTrace,
            },
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: "Failed to import student data" });
    }
});

router.post("/create-fee", auth, async(req: AuthRequest, res: Response) => {

    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const {studentId, type, total, academicYear} = req.body;

        if (!studentId || !type || !total || !academicYear) {
            return res.status(500).json({message: "Missing required fields"});
        }

        const existedFee = await prisma.fee.findUnique({
            where: {
                studentId_type_academicYear: {
                    studentId,
                    type,
                    academicYear
                }
            }
        })

        if(existedFee) {
            return res.status(404).json({message: "Fee type already existed, you can edit the fee."})
        }

        const result = await prisma.$transaction(async(tx) => {
            const fee = await tx.fee.create({
                data: {
                    studentId,
                    type,
                    total,
                    academicYear
                },

                include: {
                    student: true,
                    payments: true
                }
            })

            return fee
        })

        res.json({message: "Successfully created fee for student", data: result});
    } catch (err) {
        console.log(err);
        return res.status(403).json({message: "Error creating Fee details, Contact developer"})
    }
})

router.post("/create-payment", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const authUserId = resolveAuthUserId(req.user);
        if (!authUserId) {
            return res.status(401).json({ message: "Invalid token payload" });
        }

        const {feeId, amount, method, status, screenshot} = req.body;

        if (!feeId || !amount || !method || !status) {
            return res.status(403).json({ message: "Missing required fields" });
        }

        const payment = await prisma.payment.create({
            data: {
                feeId,
                amount: Number(amount),
                method,
                status,
                screenshot,
                verifiedById: authUserId,
                verifiedAt: new Date()
            },

            include: {
                fee: true,
                verifiedBy: true,
            }
        })

        res.json({message: "Successfully created payment", data: payment})

    } catch(err) {
        console.log(err)
        return res.status(403).json({message: "Error creating payment details, Contact developer"})
    }
})



router.put("/update-fee/:id", auth, async(req: AuthRequest, res: Response) => {
    try {

        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const {type, total, academicYear} = req.body;

        const feeId = Number(req.params.id);

        const fee_ = await prisma.fee.findUnique({
            where: {id: feeId}
        })

        if (!fee_) {
            return res.status(404).json({message: "Fee data not existed, Contact developer"});
        }

        const duplicate = await prisma.fee.findFirst({
            where: {
                studentId: fee_.studentId,
                type,
                academicYear,
                NOT: { id: feeId }
            }
        });

        if (duplicate) {
            return res.status(400).json({
                message: "Fee with same type and academic year already exists for this student"
            });
        }

        const updatedFee = await prisma.fee.update({
            where: {id: feeId},
            data: {
                type,
                total,
                academicYear
            }
        })

        res.json({message: "Fee detailes updated", data: {updatedFee}});
    } catch (err) {
        console.log(err);
        return res.status(403).json({message: "Error in editing fee cetails, Contact developer"});
    }
})


router.put("/update-payment/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        
        if (req.user.role !== "PRINCIPAL" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const authUserId = resolveAuthUserId(req.user);
        if (!authUserId) {
            return res.status(401).json({ message: "Invalid token payload" });
        }

        const {feeId, amount, method, status, screenshot} = req.body;

        const paymentId = Number(req.params.id);

        const payment_ = await prisma.payment.findUnique({
            where : {id: paymentId}
        })

        if (!payment_) {
            return res.status(700).json({message: "Payment data not existed, Contact developer"});
        }

        const updatedPayment = await prisma.payment.update({
            where: {id: paymentId},
            data: {
                feeId,
                amount:  Number(amount),
                method,
                status,
                screenshot,
                verifiedById: authUserId
            },

            include: {
                fee: true,
                verifiedBy: true
            }
        })

        res.json({message: "Payment details updated successfully", data: updatedPayment});
    } catch (err) {
        console.log(err)
        return res.status(403).json({message: "Error updating payment details, Contact developer"});
    }
})


router.get("/get-student-details-master/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (req.user.role !== "PRINCIPAL") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const studentId = Number(req.params.id);

        const student = await prisma.student.findUnique({
            where: {id: studentId},
            include: {
                class: {
                    include: {
                        teacher: {
                            include: {
                                user: true
                            }
                        }
                    }
                },
                bus: true,
                parents: {
                    include: {
                        parent: {
                            include: {
                                user: true
                            }
                        }
                    }
                },
                feeDetails: {
                    include: {
                        payments: true
                    }
                },

                marks: {
                    include: {
                        exam: {
                            include: {
                                subject: true,
                                class: {
                                    include: {
                                        teacher: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })

        if (!student) {
            return res.status(400).json({message: "Student not existed"});
        }

        const feeSummary = student.feeDetails.map((fee) => {
            const totalPaid = fee.payments.filter(p => p.status === "SUCCESS").reduce((sum, p) => sum + Number(p.amount), 0);

            return {
                ...fee,
                totalPaid,
                remaining: Number(fee.total) - totalPaid
            }
        });

        res.json({message: "Details fetched successfully", data: {...student, feeDetails: feeSummary}})
    } catch(err) {
        console.log(err)
        return res.status(400).json({message: "Error fetching the details"})
    }
})

export default router;
