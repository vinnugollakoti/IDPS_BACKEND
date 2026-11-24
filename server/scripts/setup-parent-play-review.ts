import { randomBytes, randomInt, scryptSync } from "node:crypto";
import prisma from "../prisma/client";

async function setup() {
  const email = "play-parent@review.invalid";
  await prisma.$transaction(async tx => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== "PARENT") throw new Error("Review email is already in use.");
      return;
    }
    const schoolClass = await tx.class.create({ data: { name: "Play Review", section: "Sample" } });
    await tx.user.create({ data: {
      email, role: "PARENT", name: "Sample Parent", gender: "FEMALE",
      parent: { create: {
        name: "Sample Parent", phone1: "0000000000",
        students: { create: ["A", "B"].map(label => ({ student: { create: {
          studentCode: `PLAY-REVIEW-${label}`, name: `Sample Student ${label}`,
          gender: "FEMALE", classId: schoolClass.id,
        } } })) },
      } },
    } });
  });
  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(16).toString("hex");
  console.log("Play Console username:", email);
  console.log("Play Console reusable code:", code);
  console.log("PARENT_PLAY_REVIEW_CODE_HASH=%s:%s", salt, scryptSync(code, salt, 64).toString("hex"));
}
setup().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
