import express, {Request, Response} from "express";
import prisma from "../prisma/client";
import { AuthRequest, auth, isExecutiveRole } from "../middleware/auth";
import { logAudit } from "../utils/audit";
import { serverCache } from "../utils/cache";
import { matchStudentRecord } from "../utils/studentMatcher";
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

    const monthMap: Record<string, number> = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
        jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
        january: 1, february: 2, march: 3, april: 4, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
    };

    // 1. Text Month Format: '10-Mar-22', '7-May-23', '27-Oct-2022', '23-Feb-2023'
    const textMonthMatch = text.match(/^(\d{1,2})[/\-. ]+([A-Za-z]+)[/\-. ]+(\d{2,4})$/);
    if (textMonthMatch) {
        const day = Number(textMonthMatch[1]);
        const mStr = textMonthMatch[2].toLowerCase();
        const month = monthMap[mStr];
        let year = Number(textMonthMatch[3]);
        if (year < 100) {
            year += year > 50 ? 1900 : 2000;
        }
        if (month) {
            const date = new Date(Date.UTC(year, month - 1, day));
            return Number.isNaN(date.getTime()) ? null : date;
        }
    }

    // 2. ISO Format: '2026-07-03'
    const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
    if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    // 3. Numeric DMY / MDY: '03-07-2026', '6/11/26', '5/7/23'
    const slashMatch = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
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

    // 4. Excel serial numbers (e.g. '46109', '44047')
    if (/^\d{4,5}$/.test(text)) {
        const serial = Number(text);
        if (serial >= 1000 && serial <= 80000) {
            const utcDays = serial - (serial > 60 ? 25569 : 25568);
            const utcMs = Math.round(utcDays * 86400 * 1000);
            const date = new Date(utcMs);
            if (!Number.isNaN(date.getTime())) {
                return date;
            }
        }
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

    const rawFatherName = normalizeText(row.parents?.father?.name ?? row.fatherName);
    const rawMotherName = normalizeText(row.parents?.mother?.name ?? row.motherName);
    
    // Explicit Father phone vs Mother phone (no cross bleed)
    const fatherPhone = normalizeDigits(row.parents?.father?.phone ?? (row as any).mobileFather ?? row.mobileNumber);
    const motherPhone = normalizeDigits(row.parents?.mother?.phone ?? (row as any).mobileMother);
    
    const fatherAadhar = normalizeDigits(row.parents?.father?.aadhar ?? row.fatherAadhar);
    const motherAadhar = normalizeDigits(row.parents?.mother?.aadhar ?? row.motherAadhar);
    const qualification = normalizeQualification(row.parents?.father?.qualification ?? row.parents?.mother?.qualification ?? row.qualification);

    const fatherName = rawFatherName || (fatherPhone || fatherAadhar ? "Father" : "");
    const motherName = rawMotherName || (motherPhone || motherAadhar ? "Mother" : "");

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
                      name: fatherName || "Father",
                      phone: fatherPhone || null,
                      aadhar: fatherAadhar || null,
                      qualification: qualification ?? null,
                      relation: "Father",
                  }
                : null,
            mother: motherName || motherPhone || motherAadhar
                ? {
                      name: motherName || "Mother",
                      phone: motherPhone || null,
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
            const identityChecks: any[] = [
                { classId, admissionno: row.admissionno },
            ];
            if (row.adharnumber) {
                // Aadhaar identifies the student across class/section changes;
                // do not create a second profile when a student is re-uploaded.
                identityChecks.push({ adharnumber: row.adharnumber });
            }
            const duplicate = await tx.student.findFirst({
                where: { OR: identityChecks },
                select: { id: true, name: true, admissionno: true, class: { select: { name: true, section: true } } },
            });

            if (duplicate) {
                const classLabel = duplicate.class ? `${duplicate.class.name} - ${duplicate.class.section}` : "another class";
                throw new Error(`Student already exists in the database: ${duplicate.name} (${classLabel}, ID ${duplicate.id}). Review the existing record instead of uploading a duplicate.`);
            }

            const parentInputs: Array<{ relation: "Father" | "Mother" | "Guardian"; payload: ImportParentInput | null | undefined }> = [
                { relation: "Father", payload: row.parents?.father as any },
                { relation: "Mother", payload: row.parents?.mother as any },
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
                    gender: (row.gender as any) || "MALE",
                    dob: row.dob ?? undefined,
                    adharnumber: row.adharnumber || undefined,
                    pincode: row.pincode || undefined,
                    mothertongue: (row.mothertongue as any) ?? undefined,
                    socialcategory: (row.socialcategory as any) ?? undefined,
                    bloodgroup: (row.bloodgroup as any) ?? undefined,
                    admissiondate: row.admissiondate ?? undefined,
                    height: row.height ?? undefined,
                    weight: row.weight ?? undefined,
                    address: row.address ?? undefined,
                    classId,
                },
            });
            await tx.student.update({ where: { id: student.id }, data: { studentCode: `S-${String(student.id).padStart(3, '0')}` } });

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
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
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

router.post("/bulk-ingest-portal", auth, async (req: AuthRequest, res: Response) => {
    if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
        return res.status(403).json({ message: "Only school administrators can import students" });
    }
    try {
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

        void serverCache.clear();

        return res.json({
            message: "Import completed",
            data: {
                classId,
                className: `${classExists.name}-${classExists.section}`,
                ...summary,
                stepTrace,
            },
        });
    } catch (err: any) {
        console.error("Bulk ingest portal error:", err);
        return res.status(500).json({ message: "Failed to import student data", error: err?.message });
    }
});

router.get("/qr-export-list", auth, async (req: AuthRequest, res: Response) => {
    if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
        return res.status(403).json({ message: "Only school administrators can export student QRs" });
    }
    try {
        const students = await prisma.student.findMany({
            select: {
                id: true,
                name: true,
                studentCode: true,
                admissionno: true,
                adharnumber: true,
                classId: true,
                class: {
                    select: {
                        id: true,
                        name: true,
                        section: true,
                    },
                },
            },
            orderBy: [
                { class: { name: 'asc' } },
                { class: { section: 'asc' } },
                { name: 'asc' },
            ],
        });

        return res.json({
            message: "Fetched students for QR export",
            data: students,
        });
    } catch (err: any) {
        console.error("Error fetching students for QR export:", err);
        return res.status(500).json({ message: "Failed to fetch students for QR export", error: err?.message });
    }
});

router.get("/fee/students-for-matching", auth, async (req: AuthRequest, res: Response) => {
    if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
        return res.status(403).json({ message: "Only school administrators can access fee matching data" });
    }
    try {
        const classId = req.query.classId ? Number(req.query.classId) : undefined;
        const where: any = {};
        if (classId && Number.isInteger(classId) && classId > 0) {
            where.classId = classId;
        }

        const students = await prisma.student.findMany({
            where,
            select: {
                id: true,
                name: true,
                studentCode: true,
                admissionno: true,
                adharnumber: true,
                gender: true,
                dob: true,
                classId: true,
                address: true,
                class: {
                    select: {
                        id: true,
                        name: true,
                        section: true,
                    },
                },
                parents: {
                    select: {
                        parent: {
                            select: {
                                id: true,
                                name: true,
                                relation: true,
                                phone1: true,
                                phone2: true,
                            },
                        },
                    },
                },
                feeDetails: {
                    select: {
                        id: true,
                        type: true,
                        title: true,
                        total: true,
                        academicYear: true,
                        payments: {
                            select: {
                                id: true,
                                amount: true,
                                method: true,
                                status: true,
                                screenshot: true,
                                createdAt: true,
                            },
                        },
                    },
                },
            },
            orderBy: [
                { classId: "asc" },
                { name: "asc" },
            ],
        });

        return res.json({ message: "Fetched students for fee matching", data: students });
    } catch (err: any) {
        console.error("Error fetching students for fee matching:", err);
        return res.status(500).json({ message: "Failed to fetch students for fee matching", error: err?.message });
    }
});

router.post("/fee/bulk-ingest-portal", auth, async (req: AuthRequest, res: Response) => {
    if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
        return res.status(403).json({ message: "Only school administrators can import fees" });
    }
    try {
        const academicYear = typeof req.body.academicYear === "string" && req.body.academicYear.trim()
            ? req.body.academicYear.trim()
            : "2026-2027";
        const targetClassId = req.body.classId ? Number(req.body.classId) : null;
        const items = Array.isArray(req.body.items) ? req.body.items : [];

        if (!items.length) {
            return res.status(400).json({ message: "No fee items provided for ingestion" });
        }

        const candidateStudents = await prisma.student.findMany({
            where: targetClassId ? { classId: targetClassId } : {},
            select: {
                id: true,
                name: true,
                admissionno: true,
                classId: true,
                address: true,
                parents: {
                    select: {
                        parent: {
                            select: {
                                id: true,
                                name: true,
                                relation: true,
                                phone1: true,
                                phone2: true,
                            },
                        },
                    },
                },
            },
        });

        const results = {
            academicYear,
            totalAttempted: items.length,
            matchedCount: 0,
            unmatchedCount: 0,
            feesUpserted: 0,
            paymentsRecorded: 0,
            matchedRecords: [] as any[],
            unmatchedRecords: [] as any[],
        };

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
                let matchedStudent: any = null;
                let matchMethod = "MANUAL";
                let confidence = 1.0;

                if (item.studentId && Number.isInteger(Number(item.studentId))) {
                    const sid = Number(item.studentId);
                    matchedStudent = candidateStudents.find((s) => s.id === sid) || null;
                    if (!matchedStudent) {
                        matchedStudent = await prisma.student.findUnique({
                            where: { id: sid },
                            select: {
                                id: true,
                                name: true,
                                admissionno: true,
                                classId: true,
                                address: true,
                            },
                        });
                    }
                }

                if (!matchedStudent) {
                    const matchRes = matchStudentRecord(
                        item.studentName || item.excelStudentName,
                        item.parentContact || item.excelParentPhone,
                        candidateStudents as any
                    );
                    if (matchRes.student) {
                        matchedStudent = matchRes.student;
                        matchMethod = matchRes.method;
                        confidence = matchRes.confidence;
                    }
                }

                if (!matchedStudent) {
                    results.unmatchedCount++;
                    results.unmatchedRecords.push({
                        rowNumber: i + 1,
                        excelStudentName: item.studentName || item.excelStudentName,
                        excelParentPhone: item.parentContact || item.excelParentPhone,
                        reason: "No matching student record found in database for the selected class/school.",
                    });
                    continue;
                }

            results.matchedCount++;
            const studentId = matchedStudent.id;
            const receiptStr = item.receiptNo ? String(item.receiptNo).trim() : "";
            const feesProcessed: string[] = [];

            try {
                await prisma.$transaction(async (tx) => {
                    const syncPayment = async (feeId: number, amount: number, noteLabel: string, receipt?: string) => {
                    if (!amount || amount <= 0) return;
                    const screenshotNote = receipt ? `${noteLabel} | Receipt: ${receipt}` : noteLabel;

                    const existingPayments = await tx.payment.findMany({
                        where: { feeId },
                    });

                    const existingMatch = existingPayments.find(
                        (p) => p.screenshot && p.screenshot.includes(noteLabel)
                    );

                    if (existingMatch) {
                        if (Number(existingMatch.amount) !== amount) {
                            await tx.payment.update({
                                where: { id: existingMatch.id },
                                data: { amount, screenshot: screenshotNote },
                            });
                        }
                    } else {
                        await tx.payment.create({
                            data: {
                                feeId,
                                amount,
                                method: "CASH",
                                status: "SUCCESS",
                                screenshot: screenshotNote,
                                verifiedAt: new Date(),
                            },
                        });
                        results.paymentsRecorded++;
                    }
                };

                // A. TUITION FEE
                const tuitionTotal = Number(item.tuitionFee) || 0;
                const t1 = Number(item.term1TuitionPaid) || 0;
                const t2 = Number(item.term2TuitionPaid) || 0;
                const t3 = Number(item.term3TuitionPaid) || 0;

                if (tuitionTotal > 0 || (t1 + t2 + t3) > 0) {
                    const finalTuitionTotal = tuitionTotal > 0 ? tuitionTotal : (t1 + t2 + t3);
                    const feeRecord = await tx.fee.upsert({
                        where: {
                            studentId_type_academicYear: {
                                studentId,
                                type: "TUITION",
                                academicYear,
                            },
                        },
                        update: {
                            title: "Tuition Fee",
                            total: finalTuitionTotal,
                        },
                        create: {
                            studentId,
                            type: "TUITION",
                            academicYear,
                            title: "Tuition Fee",
                            total: finalTuitionTotal,
                        },
                    });
                    results.feesUpserted++;
                    feesProcessed.push(`TUITION (₹${finalTuitionTotal})`);

                    if (t1 > 0) await syncPayment(feeRecord.id, t1, "Tuition Term 1", receiptStr);
                    if (t2 > 0) await syncPayment(feeRecord.id, t2, "Tuition Term 2", receiptStr);
                    if (t3 > 0) await syncPayment(feeRecord.id, t3, "Tuition Term 3", receiptStr);
                }

                // B. BUS / TRANSPORT FEE
                const transFee = Number(item.transportFee) || 0;
                const transT1 = Number(item.transportTerm1Paid) || 0;
                const transT2 = Number(item.transportTerm2Paid) || 0;
                const place = item.place || item.transportPlace || "";

                if (transFee > 0 || (transT1 + transT2) > 0) {
                    const finalTransTotal = transFee > 0 ? transFee : (transT1 + transT2);
                    const feeRecord = await tx.fee.upsert({
                        where: {
                            studentId_type_academicYear: {
                                studentId,
                                type: "BUS",
                                academicYear,
                            },
                        },
                        update: {
                            title: "Transport Fee",
                            total: finalTransTotal,
                        },
                        create: {
                            studentId,
                            type: "BUS",
                            academicYear,
                            title: "Transport Fee",
                            total: finalTransTotal,
                        },
                    });
                    results.feesUpserted++;
                    feesProcessed.push(`BUS (₹${finalTransTotal})`);

                    const routeNote = place ? `Route: ${place}` : "";
                    if (transT1 > 0) await syncPayment(feeRecord.id, transT1, `Transport Term 1${routeNote ? " | " + routeNote : ""}`, receiptStr);
                    if (transT2 > 0) await syncPayment(feeRecord.id, transT2, `Transport Term 2${routeNote ? " | " + routeNote : ""}`, receiptStr);
                }

                // C. BOOKS & UNIFORM FEE
                const booksFee = Number(item.booksFee) || 0;
                const booksPaid = Number(item.booksPaid) || 0;
                const extraUniform = Number(item.extraUniform) || 0;

                if (booksFee > 0 || booksPaid > 0 || extraUniform > 0) {
                    const finalBooksTotal = (booksFee || 0) + (extraUniform || 0);
                    const feeRecord = await tx.fee.upsert({
                        where: {
                            studentId_type_academicYear: {
                                studentId,
                                type: "BOOKS_UNIFORM",
                                academicYear,
                            },
                        },
                        update: {
                            title: "Books & Uniform",
                            total: finalBooksTotal,
                        },
                        create: {
                            studentId,
                            type: "BOOKS_UNIFORM",
                            academicYear,
                            title: "Books & Uniform",
                            total: finalBooksTotal,
                        },
                    });
                    results.feesUpserted++;
                    feesProcessed.push(`BOOKS_UNIFORM (₹${finalBooksTotal})`);

                    if (booksPaid > 0) {
                        await syncPayment(feeRecord.id, booksPaid, "Books & Uniform", receiptStr);
                    }
                    // EXTRA UNIFORM is a separately paid component in the source workbook.
                    // It is included in the Books & Uniform fee total, so it must also be
                    // recorded as a payment; otherwise collected totals are understated.
                    if (extraUniform > 0) {
                        await syncPayment(feeRecord.id, extraUniform, "Extra Uniform", receiptStr);
                    }
                }

                // D. REGISTRATION FEE
                const regPaid = Number(item.regFeePaid) || 0;
                if (regPaid > 0) {
                    const feeRecord = await tx.fee.upsert({
                        where: {
                            studentId_type_academicYear: {
                                studentId,
                                type: "REGISTRATION",
                                academicYear,
                            },
                        },
                        update: {
                            title: "Admission & Registration Fee",
                            total: regPaid,
                        },
                        create: {
                            studentId,
                            type: "REGISTRATION",
                            academicYear,
                            title: "Admission & Registration Fee",
                            total: regPaid,
                        },
                    });
                    results.feesUpserted++;
                    feesProcessed.push(`REGISTRATION (₹${regPaid})`);

                    await syncPayment(feeRecord.id, regPaid, "Admission & Registration Fee", receiptStr);
                }

                // Update student address if missing and place is provided
                if (place && (!matchedStudent.address || matchedStudent.address.trim() === "")) {
                    await tx.student.update({
                        where: { id: studentId },
                        data: { address: place },
                    });
                }

                }, { maxWait: 10000, timeout: 15000 });

                results.matchedRecords.push({
                    studentId,
                    studentName: matchedStudent.name,
                    admissionno: matchedStudent.admissionno,
                    matchMethod,
                    confidence,
                    feesProcessed,
                });
            } catch (studentErr: any) {
                console.error(`Error processing fees for student ${matchedStudent.name}:`, studentErr);
                results.unmatchedRecords.push({
                    rowNumber: i + 1,
                    excelStudentName: matchedStudent.name,
                    excelParentPhone: item.parentContact || item.excelParentPhone,
                    reason: studentErr?.message || "Failed to update student fee in database",
                });
            }
        }

        void serverCache.clear();

        return res.json({
            message: "Fee ingestion completed successfully",
            data: results,
        });
    } catch (err: any) {
        console.error("Bulk fee ingest error:", err);
        return res.status(500).json({ message: "Failed to ingest fee data", error: err?.message });
    }
});

function parseFeeType(rawType: any): "TUITION" | "BUS" | "EXAM" | "BOOKS_UNIFORM" | "REGISTRATION" | "OTHER" {
    if (!rawType) return "OTHER";
    const str = String(rawType).toUpperCase().trim();
    if (str === "TUITION" || str.includes("TUITION") || str.includes("ACADEMIC")) return "TUITION";
    if (str === "BUS" || str.includes("BUS") || str.includes("TRANSPORT")) return "BUS";
    if (str === "EXAM" || str.includes("EXAM") || str.includes("TEST")) return "EXAM";
    if (str === "BOOKS_UNIFORM" || str.includes("BOOK") || str.includes("UNIFORM")) return "BOOKS_UNIFORM";
    if (str === "REGISTRATION" || str.includes("REG") || str.includes("ADMISSION")) return "REGISTRATION";
    return "OTHER";
}

const parsePositiveMoney = (value: unknown): number | null => {
    if (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 && amount <= 1000000000 ? Math.round(amount * 100) / 100 : null;
};

const validAcademicYear = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}-\d{4}$/.test(value.trim());

router.post("/create-fee", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"});
        }

        const {studentId, type, title, total, academicYear} = req.body;

        const parsedStudentId = Number(studentId);
        const parsedTotal = parsePositiveMoney(total);
        if (!Number.isInteger(parsedStudentId) || parsedStudentId <= 0 || !type || parsedTotal === null || !validAcademicYear(academicYear)) {
            return res.status(400).json({message: "Student, fee type, a positive amount (up to 2 decimals), and a valid academic year are required."});
        }
        if (!(await prisma.student.findUnique({ where: { id: parsedStudentId }, select: { id: true } }))) {
            return res.status(404).json({ message: "Student record not found." });
        }

        const feeTitle = (title || type).trim();
        const feeTypeEnum = parseFeeType(type);
        const normalizedYear = academicYear.trim();

        const result = await prisma.$transaction(async(tx) => {
            const existingFee = await tx.fee.findUnique({
                where: {
                    studentId_type_academicYear: {
                        studentId: parsedStudentId,
                        type: feeTypeEnum,
                        academicYear: normalizedYear
                    }
                },
                include: {
                    payments: true
                }
            });

            if (existingFee) {
                // If a fee record for this type already exists, increase the total amount
                // and append the new description if it's different.
                const newTotal = Number(existingFee.total) + parsedTotal;
                const updatedTitle = existingFee.title && existingFee.title !== feeTitle
                    ? `${existingFee.title} + ${feeTitle}`
                    : (feeTitle || existingFee.title);

                const updatedFee = await tx.fee.update({
                    where: { id: existingFee.id },
                    data: {
                        total: newTotal,
                        title: updatedTitle
                    },
                    include: {
                        student: true,
                        payments: {
                            include: {
                                verifiedBy: true
                            }
                        }
                    }
                });
                return updatedFee;
            }

            const fee = await tx.fee.create({
                data: {
                    studentId: parsedStudentId,
                    title: feeTitle,
                    type: feeTypeEnum,
                    total: parsedTotal,
                    academicYear: normalizedYear
                },

                include: {
                    student: true,
                    payments: {
                        include: {
                            verifiedBy: true
                        }
                    }
                }
            });

            return fee;
        });

        const studentInfo = await prisma.student.findUnique({
            where: { id: Number(studentId) },
            select: { id: true, name: true, admissionno: true }
        });
        const studentNameStr = studentInfo ? `${studentInfo.name} (#${studentInfo.admissionno || studentInfo.id})` : `Student ID #${studentId}`;

        void logAudit({
            req,
            action: "CREATE_FEE",
            tag: "FEE",
            details: `[FEE ASSIGNED / INCREASED] Performed by ${req.user.name || req.user.role} (${req.user.role}). Assigned/Updated ${feeTypeEnum} fee structure "${feeTitle}" of ₹${Number(total).toLocaleString('en-IN')} (Academic Year: ${academicYear}) for student ${studentNameStr}.`,
            entityType: "Fee",
            entityId: result.id,
        });

        serverCache.invalidate("get-fees");
        serverCache.invalidate("get-students");

        return res.json({message: "Fee bill saved successfully", data: result});

    } catch (error: any) {
        console.error("Error creating fee:", error);
        return res.status(500).json({message: error?.message || "Error creating Fee bill"});
    }
});

router.post("/create-class-fee", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const { classId, type, title, total, academicYear } = req.body;

        const parsedClassId = Number(classId);
        const parsedTotal = parsePositiveMoney(total);
        if (!Number.isInteger(parsedClassId) || parsedClassId <= 0 || !type || parsedTotal === null || !validAcademicYear(academicYear)) {
            return res.status(400).json({ message: "Class, fee type, a positive amount (up to 2 decimals), and a valid academic year are required." });
        }
        if (!(await prisma.class.findUnique({ where: { id: parsedClassId }, select: { id: true } }))) {
            return res.status(404).json({ message: "Class record not found." });
        }

        const feeTitle = title || type;
        const feeTypeEnum = parseFeeType(type);

        const students = await prisma.student.findMany({
            where: { classId: parsedClassId }
        });

        if (students.length === 0) {
            return res.status(404).json({ message: "No students enrolled in this class" });
        }

        let addedCount = 0;
        let skippedCount = 0;

        await prisma.$transaction(async (tx) => {
            for (const student of students) {
                const existing = await tx.fee.findUnique({
                    where: { studentId_type_academicYear: { studentId: student.id, type: feeTypeEnum, academicYear: academicYear.trim() } },
                    select: { id: true },
                });
                if (existing) {
                    skippedCount++;
                    continue;
                }
                await tx.fee.create({ data: { studentId: student.id, title: feeTitle, type: feeTypeEnum, total: parsedTotal, academicYear: academicYear.trim() } });
                addedCount++;
            }
        });

        const classObj = await prisma.class.findUnique({
            where: { id: Number(classId) },
            select: { name: true, section: true }
        });
        const classNameStr = classObj ? `${classObj.name}-${classObj.section}` : `Class ID #${classId}`;

        void logAudit({
            req,
            action: "CREATE_CLASS_FEE",
            tag: "FEE",
            details: `[CLASS FEE APPLIED] Applied ${feeTypeEnum} fee structure "${feeTitle}" of ₹${Number(total).toLocaleString('en-IN')} (${academicYear}) to all ${addedCount} student(s) in ${classNameStr}. Total class fee increased by +₹${(Number(total) * addedCount).toLocaleString('en-IN')}.`,
            entityType: "Class",
            entityId: parsedClassId,
        });

        serverCache.invalidate("get-fees");
        serverCache.invalidate("get-students");

        return res.json({
            message: `Applied ${type} fee to ${addedCount} student(s).${skippedCount ? ` ${skippedCount} existing fee(s) were left unchanged.` : ""}`,
            addedCount,
            skippedCount
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ message: "Error assigning fee to class, Contact developer" });
    }
})

router.post("/create-payment", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"});
        }

        const authUserId = resolveAuthUserId(req.user);
        if (!authUserId) {
            return res.status(401).json({ message: "Invalid token payload" });
        }

        const { feeId, feeStructureId, amount, method, status, screenshot, customReason, applyToCategory, paymentDate, date } = req.body;
        let targetFeeId = feeId || feeStructureId;

        const parsedAmount = parsePositiveMoney(amount);
        const parsedFeeId = Number(targetFeeId);
        const normalizedMethod = String(method || "CASH").toUpperCase();
        const normalizedStatus = String(status || "SUCCESS").toUpperCase();
        const rawDate = paymentDate || date;
        let effectiveDate = new Date();
        if (rawDate) {
            const dateStr = String(rawDate).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                effectiveDate = new Date(`${dateStr}T12:00:00.000Z`);
            } else if (!Number.isNaN(Date.parse(dateStr))) {
                effectiveDate = new Date(dateStr);
            }
        }
        if (!Number.isInteger(parsedFeeId) || parsedFeeId <= 0 || parsedAmount === null) {
            return res.status(400).json({ message: "A valid fee and a positive payment amount with at most 2 decimals are required." });
        }
        if (!["CASH", "ONLINE"].includes(normalizedMethod) || !["PENDING", "SUCCESS", "REJECTED"].includes(normalizedStatus)) {
            return res.status(400).json({ message: "Invalid payment method or status." });
        }

        let noteParts: string[] = [];
        if (applyToCategory) {
            noteParts.push(`Category: ${applyToCategory}`);
        }
        if (customReason) {
            noteParts.push(`Reason: ${customReason}`);
        }
        if (screenshot) {
            noteParts.push(`Notes: ${screenshot}`);
        }
        const noteText = noteParts.length > 0 ? noteParts.join(' | ') : undefined;

        const payment = await prisma.$transaction(async (tx) => {
            // Serialize payments for the same fee so two simultaneous requests
            // cannot both observe the same remaining balance and over-collect.
            await tx.$queryRaw`SELECT "id" FROM "Fee" WHERE "id" = ${parsedFeeId} FOR UPDATE`;
            const fee = await tx.fee.findUnique({ where: { id: parsedFeeId }, include: { payments: { select: { amount: true, status: true } } } });
            if (!fee) throw Object.assign(new Error("Fee record not found."), { statusCode: 404 });
            if (normalizedStatus === "SUCCESS") {
                const paid = fee.payments.filter((item) => item.status === "SUCCESS").reduce((sum, item) => sum + Number(item.amount), 0);
                const remaining = Math.max(0, Number(fee.total) - paid);
                if (parsedAmount > remaining + 0.005) {
                    throw Object.assign(new Error(`Payment exceeds the remaining balance of ₹${remaining.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`), { statusCode: 422 });
                }
            }
            return tx.payment.create({
                data: {
                    feeId: parsedFeeId,
                    amount: parsedAmount,
                    method: normalizedMethod as any,
                    status: normalizedStatus as any,
                    screenshot: noteText,
                    verifiedById: authUserId,
                    verifiedAt: effectiveDate,
                    createdAt: effectiveDate,
                },
                include: { fee: true, verifiedBy: true },
            });
        });

        const feeWithStudent = await prisma.fee.findUnique({
            where: { id: Number(targetFeeId) },
            include: { student: true }
        });
        const stName = feeWithStudent?.student ? `${feeWithStudent.student.name} (#${feeWithStudent.student.admissionno || feeWithStudent.student.id})` : `Student Fee ID #${targetFeeId}`;
        const feeCategory = feeWithStudent ? feeWithStudent.title || feeWithStudent.type : 'Fee';

        void logAudit({
            req,
            action: "CREATE_PAYMENT",
            tag: "FEE",
            details: `[FEE PAYMENT RECORDED] Performed by ${req.user.name || req.user.role} (${req.user.role}). Recorded ${method ? method.toUpperCase() : "CASH"} payment of ₹${Number(amount).toLocaleString('en-IN')} towards ${feeCategory} for ${stName}. Outstanding due decreased by -₹${Number(amount).toLocaleString('en-IN')}.${noteText ? ` Notes: ${noteText}` : ''}`,
            entityType: "Payment",
            entityId: payment.id,
        });

        serverCache.invalidate("get-fees");
        serverCache.invalidate("get-students");

        res.json({message: "Successfully created payment", data: payment})

    } catch(err) {
        console.log(err)
        const statusCode = Number((err as any)?.statusCode) || 500;
        return res.status(statusCode).json({message: (err as any)?.message || "Error creating payment details"})
    }
})



router.put("/update-fee/:id", auth, async(req: AuthRequest, res: Response) => {
    try {

        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const {type, total, academicYear} = req.body;
        const parsedTotal = parsePositiveMoney(total);
        if (!type || parsedTotal === null || !validAcademicYear(academicYear)) {
            return res.status(400).json({message: "Fee type, a positive amount with at most 2 decimals, and a valid academic year are required."});
        }

        const feeId = Number(req.params.id);
        if (!Number.isInteger(feeId) || feeId <= 0) {
            return res.status(400).json({message: "Invalid fee id"});
        }

        const fee_ = await prisma.fee.findUnique({
            where: {id: feeId}
        })

        if (!fee_) {
            return res.status(404).json({message: "Fee data not existed, Contact developer"});
        }

        const paidForFee = await prisma.payment.aggregate({
            where: { feeId, status: "SUCCESS" },
            _sum: { amount: true },
        });
        if (parsedTotal + 0.005 < Number(paidForFee._sum.amount || 0)) {
            return res.status(422).json({ message: "Fee total cannot be lower than payments already recorded for this fee." });
        }

        const duplicate = await prisma.fee.findFirst({
            where: {
                studentId: fee_.studentId,
                type: parseFeeType(type),
                academicYear: academicYear.trim(),
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
                type: parseFeeType(type),
                total: parsedTotal,
                academicYear: academicYear.trim(),
            },
            include: {
                student: true
            }
        });

        const oldTotal = Number(fee_.total) || 0;
        const newTotal = Number(total) || 0;
        const diff = newTotal - oldTotal;
        const changeDir = diff > 0 ? `INCREASED by +₹${diff.toLocaleString('en-IN')}` : diff < 0 ? `DECREASED by -₹${Math.abs(diff).toLocaleString('en-IN')}` : 'Unchanged total';
        const stNameStr = (updatedFee as any).student ? `${(updatedFee as any).student.name} (#${(updatedFee as any).student.admissionno || (updatedFee as any).student.id})` : `Student ID #${fee_.studentId}`;

        void logAudit({
            req,
            action: "UPDATE_FEE",
            tag: "FEE",
            details: `[FEE BILL UPDATED] Performed by ${req.user.name || req.user.role} (${req.user.role}). Updated Fee ID #${feeId} for ${stNameStr}. Type: ${type}, Academic Year: ${academicYear}. Fee total was ${changeDir} (Previous: ₹${oldTotal.toLocaleString('en-IN')}, New: ₹${newTotal.toLocaleString('en-IN')}).`,
            entityType: "Fee",
            entityId: feeId,
        });

        res.json({message: "Fee detailes updated", data: {updatedFee}});
    } catch (err) {
        console.log(err);
        return res.status(403).json({message: "Error in editing fee cetails, Contact developer"});
    }
})


router.put("/update-payment/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        
        if (!isExecutiveRole(req.user.role) && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const authUserId = resolveAuthUserId(req.user);
        if (!authUserId) {
            return res.status(401).json({ message: "Invalid token payload" });
        }

        const {feeId, amount, method, status, screenshot} = req.body;
        const parsedAmount = parsePositiveMoney(amount);

        const paymentId = Number(req.params.id);
        if (!Number.isInteger(paymentId) || paymentId <= 0) {
            return res.status(400).json({message: "Invalid payment id"});
        }

        const payment_ = await prisma.payment.findUnique({
            where : {id: paymentId}
        })

        if (!payment_) {
            return res.status(404).json({message: "Payment data not existed, Contact developer"});
        }
        const normalizedMethod = String(method || payment_.method || "CASH").toUpperCase();
        const normalizedStatus = String(status || payment_.status || "SUCCESS").toUpperCase();
        if (parsedAmount === null || !["CASH", "ONLINE"].includes(normalizedMethod) || !["PENDING", "SUCCESS", "REJECTED"].includes(normalizedStatus)) {
            return res.status(400).json({ message: "Invalid payment amount, method, or status." });
        }

        const targetFeeId = feeId === undefined || feeId === null ? payment_.feeId : Number(feeId);
        if (!Number.isInteger(targetFeeId) || targetFeeId <= 0 || targetFeeId !== payment_.feeId) {
            return res.status(400).json({ message: "A payment cannot be moved to another fee record." });
        }
        if (normalizedStatus === "SUCCESS") {
            const fee = await prisma.fee.findUnique({ where: { id: payment_.feeId }, include: { payments: { select: { id: true, amount: true, status: true } } } });
            if (!fee) return res.status(404).json({ message: "Fee record not found." });
            const paidExcludingCurrent = fee.payments.filter((item) => item.id !== paymentId && item.status === "SUCCESS").reduce((sum, item) => sum + Number(item.amount), 0);
            const remaining = Math.max(0, Number(fee.total) - paidExcludingCurrent);
            if (parsedAmount > remaining + 0.005) {
                return res.status(422).json({ message: `Payment exceeds the remaining balance of ₹${remaining.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` });
            }
        }

        const updatedPayment = await prisma.payment.update({
            where: {id: paymentId},
            data: {
                feeId: targetFeeId,
                amount: parsedAmount,
                method: normalizedMethod as any,
                status: normalizedStatus as any,
                screenshot,
                verifiedById: authUserId
            },

            include: {
                fee: true,
                verifiedBy: true
            }
        })

        const oldAmt = Number(payment_.amount) || 0;
        const newAmt = Number(amount) || 0;
        const amtDiff = newAmt - oldAmt;
        const amtChangeStr = amtDiff > 0 ? `amount INCREASED by +₹${amtDiff.toLocaleString('en-IN')}` : amtDiff < 0 ? `amount DECREASED by -₹${Math.abs(amtDiff).toLocaleString('en-IN')}` : 'amount unchanged';

        void logAudit({
            req,
            action: "UPDATE_PAYMENT",
            tag: "FEE",
            details: `[FEE PAYMENT UPDATED] Performed by ${req.user.name || req.user.role} (${req.user.role}). Updated Payment ID #${paymentId} for Fee ID #${feeId || payment_.feeId}. Payment ${amtChangeStr} (Previous: ₹${oldAmt.toLocaleString('en-IN')}, New: ₹${newAmt.toLocaleString('en-IN')}). Method: ${method}, Status: ${status}.`,
            entityType: "Payment",
            entityId: paymentId,
        });

        res.json({message: "Payment details updated successfully", data: updatedPayment});
    } catch (err) {
        console.log(err)
        return res.status(403).json({message: "Error updating payment details, Contact developer"});
    }
})


router.get("/get-student-details-master/:id", auth, async(req: AuthRequest, res: Response) => {
    try {
        if (!isExecutiveRole(req.user.role) && req.user.role !== "PARENT" && req.user.role !== "TEACHER" && req.user.role !== "RECEPTIONIST") {
            return res.status(403).json({message: "Unauthorized request"})
        }

        const studentId = Number(req.params.id);
        if (!Number.isFinite(studentId) || studentId <= 0) {
            return res.status(400).json({message: "Invalid student id"});
        }

        if (req.user.role === "PARENT") {
            const authUserId = resolveAuthUserId(req.user);
            if (!authUserId) {
                return res.status(401).json({ message: "Invalid token payload" });
            }

            const parent = await prisma.parent.findFirst({
                where: { userId: authUserId },
                select: { id: true }
            });

            if (!parent) {
                return res.status(403).json({message: "Unauthorized request"});
            }

            const linked = await prisma.parentStudent.findUnique({
                where: {
                    parentId_studentId: {
                        parentId: parent.id,
                        studentId
                    }
                },
                select: { studentId: true }
            });

            if (!linked) {
                return res.status(403).json({message: "Unauthorized request"});
            }
        }

        const student = await prisma.student.findUnique({
            where: {id: studentId},
            include: {
                class: {
                    include: {
                        teacher: {
                            include: { user: { select: { id: true, name: true, email: true, gender: true, photoUrl: true } } }
                        }
                    }
                },
                bus: true,
                parents: {
                    include: {
                        parent: {
                            include: {
                                user: { select: { id: true, name: true, email: true, gender: true, photoUrl: true } }
                            }
                        }
                    }
                },
                feeDetails: {
                    include: {
                        payments: {
                            include: {
                                verifiedBy: { select: { id: true, name: true, email: true, role: true } }
                            }
                        }
                    }
                },

                attendances: {
                    orderBy: { createdAt: "desc" },
                    take: 120,
                    include: {
                        session: { select: { id: true, date: true, classId: true } }
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
