import prisma from "../prisma/client";

async function main() {
  const result = await prisma.userPermission.updateMany({
    where: { user: { role: "TEACHER" }, module: "fees" },
    data: { isAllowed: false },
  });
  console.log(JSON.stringify({ teacherFeePermissionsDisabled: result.count }));
}

main().finally(() => prisma.$disconnect());
