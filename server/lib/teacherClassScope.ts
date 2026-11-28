import type { Prisma } from "../generated/prisma/client";
import prisma from "../prisma/client";
import { isExecutiveRole } from "../middleware/auth";
import { resolveAuthUserId } from "./authIdentity";

/** Shared primary-or-secondary teacher scope, always empty for an invalid user. */
export const assignedClasses = (userId: number): Prisma.ClassWhereInput =>
  Number.isSafeInteger(userId) && userId > 0
    ? { OR: [{ teacher: { userId } }, { teachers: { some: { teacher: { userId } } } }] }
    : { id: { in: [] } };

export const assignedClassesByTeacherId = (teacherId: number): Prisma.ClassWhereInput =>
  Number.isSafeInteger(teacherId) && teacherId > 0
    ? { OR: [{ teacherId }, { teachers: { some: { teacherId } } }] }
    : { id: { in: [] } };

export async function assignedTeacherClassIds(userId: number): Promise<number[]> {
  const classes = await prisma.class.findMany({ where: assignedClasses(userId), select: { id: true } });
  return classes.map(item => item.id);
}

export async function canManageClass(user: { role?: string; userId?: unknown; id?: unknown }, classId: number): Promise<boolean> {
  if (!Number.isSafeInteger(classId) || classId < 1) return false;
  if (isExecutiveRole(user.role) || user.role === "RECEPTIONIST") return true;
  if (user.role !== "TEACHER") return false;
  const userId = resolveAuthUserId(user);
  return userId !== null && Boolean(await prisma.class.findFirst({
    where: { id: classId, ...assignedClasses(userId) }, select: { id: true },
  }));
}
