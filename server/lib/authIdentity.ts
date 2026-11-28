/** JWTs contain userId; never key authorization or caches off a missing id field. */
export function resolveAuthUserId(user: { userId?: unknown; id?: unknown } | null | undefined): number | null {
  const value = Number(user?.userId ?? user?.id);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
