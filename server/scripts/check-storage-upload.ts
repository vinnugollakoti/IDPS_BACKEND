import assert from "node:assert/strict";
import {
  uploadHomeworkFile, uploadTeacherAttendanceSelfie, uploadNotificationImage,
  uploadExpenseBill, uploadUserProfilePhoto,
} from "../lib/supabaseStorage";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const calls: Array<{ url: string; upsert: string | null; contentType: string | null }> = [];
const png = "data:image/png;base64," + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString("base64");
const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4\n").toString("base64");

async function main() {
  process.env.SUPABASE_URL = "https://storage.example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), upsert: headers.get("x-upsert"), contentType: headers.get("content-type") });
    assert.equal(headers.get("authorization"), "Bearer test-key");
    return new Response(null, { status: 200 });
  };
  try {
    const homework = await uploadHomeworkFile({ imageBase64: pdf, path: "homework/check" });
    const selfie = await uploadTeacherAttendanceSelfie({ imageBase64: png, path: "teacher/check" });
    const notice = await uploadNotificationImage({ imageBase64: png, path: "notice/check" });
    const expense = await uploadExpenseBill({ imageBase64: png, path: "expense/check" });
    const profile = await uploadUserProfilePhoto({ imageBase64: png, path: "profile/check" });
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
      "/storage/v1/object/homework/homework/check.pdf",
      "/storage/v1/object/teacher-attendance/teacher/check.png",
      "/storage/v1/object/notification-images/notice/check.png",
      "/storage/v1/object/expense-bills/expense/check.png",
      "/storage/v1/object/user-profiles/profile/check.png",
    ]);
    assert.deepEqual(calls.map(call => call.upsert), ["false", "false", "true", "false", "true"]);
    assert.equal(homework.mimeType, "application/pdf");
    assert.equal(selfie.selfieMimeType, "image/png");
    assert.equal(notice.imageMimeType, "image/png");
    assert.equal(expense.billMimeType, "image/png");
    assert.equal(profile.imageMimeType, "image/png");
    console.log("Storage upload contracts passed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
