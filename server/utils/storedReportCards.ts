import prisma from "../prisma/client";

// Published exam marks predate the optional report-card supplement.
export async function storedReportCards(studentId:number, examIds:number[]) {
  if (!examIds.length) return [];
  try {
    return await prisma.reportCard.findMany({where:{studentId,examId:{in:examIds}}});
  } catch (error:any) {
    if (error?.code === "P2021" && String(error.message).includes("ReportCard")) return [];
    throw error;
  }
}
