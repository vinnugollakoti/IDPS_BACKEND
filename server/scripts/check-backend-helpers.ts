import assert from "node:assert/strict";
import { resolveAuthUserId } from "../lib/authIdentity";
import { assignedClasses, assignedClassesByTeacherId } from "../lib/teacherClassScope";
import { isSchoolAdministratorRole } from "../middleware/auth";
import { isBusTripStale, staleTripCutoff } from "../lib/busTripFreshness";

assert.equal(resolveAuthUserId({ userId: 705 }), 705);
assert.equal(resolveAuthUserId({ id: 705 }), 705);
assert.equal(resolveAuthUserId({ userId: undefined, id: undefined }), null);
assert.equal(resolveAuthUserId({ userId: 1.5 }), null);
assert.deepEqual(assignedClasses(0), { id: { in: [] } });
assert.deepEqual(assignedClassesByTeacherId(0), { id: { in: [] } });
assert.equal(isSchoolAdministratorRole("RECEPTIONIST"), true);
assert.equal(isSchoolAdministratorRole("TEACHER"), false);
assert.equal(isBusTripStale(new Date(10_000), 100_000), false);
assert.equal(isBusTripStale(new Date(9_999), 100_000), true);
assert.equal(staleTripCutoff(100_000).getTime(), 10_000);
console.log("Backend helper contracts passed");
