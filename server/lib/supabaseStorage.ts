// ─── Types ───────────────────────────────────────────────────────────────────

type ParsedImage = {
  buffer: Buffer;
  mimeType: string;
  extension: "jpg" | "png" | "webp";
  sizeBytes: number;
};

type ParsedDocument = {
  buffer: Buffer;
  mimeType: string;
  extension: "jpg" | "png" | "webp" | "pdf";
  sizeBytes: number;
};

type UploadImageInput = {
  imageBase64: string;
  imageMimeType?: string;
  path: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES: Record<string, ParsedImage["extension"]> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "jpg",
  "image/heif": "jpg",
};

const TEACHER_SELFIE_MAX_BYTES = Number(process.env.TEACHER_ATTENDANCE_MAX_IMAGE_BYTES ?? 3 * 1024 * 1024);
const NOTIFICATION_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB (was 15 MB)
const HOMEWORK_FILE_MAX_BYTES = 5 * 1024 * 1024;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const matchesImageSignature = (buffer: Buffer, mimeType: string): boolean => {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    // Check JPEG SOI marker
    return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
  }
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (mimeType === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  // HEIC/HEIF and other formats — trust the MIME type if buffer is non-empty
  return buffer.length > 0;
};

/**
 * Parse a base64 image string (with or without data URI prefix)
 * and return buffer + metadata. Throws on invalid/unsupported input.
 */
const parseBase64Image = (
  imageBase64: unknown,
  imageMimeType: unknown,
  maxBytes: number,
  label: string
): ParsedImage => {
  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    throw new Error(`${label}: imageBase64 is required`);
  }

  const trimmed = imageBase64.trim();

  // Accept both:  "data:image/jpeg;base64,<payload>"  and bare base64 strings
  const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9+\-.]+);base64,(.+)$/s);

  let mimeType: string;
  let base64Payload: string;

  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1].toLowerCase().trim();
    base64Payload = dataUrlMatch[2].replace(/\s/g, "");
  } else {
    // Bare base64 — use provided mimeType hint
    mimeType =
      typeof imageMimeType === "string"
        ? imageMimeType.toLowerCase().trim()
        : "image/jpeg";
    base64Payload = trimmed.replace(/\s/g, "");
  }

  // Normalize image/jpg → image/jpeg
  if (mimeType === "image/jpg") mimeType = "image/jpeg";

  const extension: ParsedImage["extension"] = SUPPORTED_MIME_TYPES[mimeType] ?? "jpg";

  // Validate base64 characters
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64Payload)) {
    throw new Error(`${label}: imageBase64 contains invalid characters`);
  }

  const buffer = Buffer.from(base64Payload, "base64");

  if (buffer.length === 0) {
    throw new Error(`${label}: decoded image buffer is empty`);
  }

  if (buffer.length > maxBytes) {
    throw new Error(
      `${label}: image must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller (received ${(buffer.length / (1024 * 1024)).toFixed(1)} MB)`
    );
  }

  if (!matchesImageSignature(buffer, mimeType)) {
    throw new Error(`${label}: image content does not match declared type "${mimeType}"`);
  }

  return {
    buffer,
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
    extension,
    sizeBytes: buffer.length,
  };
};

const parseBase64Document = (value: unknown, mimeHint: unknown): ParsedDocument => {
  if (typeof value !== "string" || !value.trim()) throw new Error("Homework attachment is empty");
  const trimmed = value.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/s);
  let mimeType = (match?.[1] || (typeof mimeHint === "string" ? mimeHint : "application/octet-stream")).toLowerCase();
  const payload = (match?.[2] || trimmed).replace(/\s/g, "");
  const extensions: Record<string, ParsedDocument["extension"]> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
  if (mimeType === "image/jpg") mimeType = "image/jpeg";
  const extension = extensions[mimeType];
  if (!extension) throw new Error("Homework attachments must be JPG, PNG, WebP, or PDF files");
  if (!/^[A-Za-z0-9+/]+=*$/.test(payload)) throw new Error("Homework attachment contains invalid data");
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length || buffer.length > HOMEWORK_FILE_MAX_BYTES) throw new Error("Each homework attachment must be 15 MB or smaller");
  return { buffer, mimeType, extension, sizeBytes: buffer.length };
};

export const uploadHomeworkFile = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_HOMEWORK_BUCKET ?? "homework";
  if (!url || !serviceRoleKey) throw new Error("Supabase storage is not configured");
  const parsed = parseBase64Document(imageBase64, imageMimeType);
  const objectPath = `${path}.${parsed.extension}`;
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, "Content-Type": parsed.mimeType, "Cache-Control": "31536000", "x-upsert": "false" },
    body: parsed.buffer as unknown as BodyInit,
  });
  if (!response.ok) throw new Error(`Failed to upload homework attachment: ${await response.text().catch(() => response.statusText)}`);
  return { name: objectPath.split("/").pop() || objectPath, url: `${url}/storage/v1/object/public/${bucket}/${objectPath}`, path: objectPath, mimeType: parsed.mimeType, sizeBytes: parsed.sizeBytes };
};

// ─── Legacy alias (used by teacher attendance) ─────────────────────────────────

export const parseTeacherSelfie = (imageBase64?: unknown, imageMimeType?: unknown): ParsedImage =>
  parseBase64Image(imageBase64, imageMimeType, TEACHER_SELFIE_MAX_BYTES, "TeacherSelfie");

// ─── Teacher Attendance Upload ────────────────────────────────────────────────

const getTeacherBucketConfig = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_TEACHER_ATTENDANCE_BUCKET ?? "teacher-attendance";

  if (!url || !serviceRoleKey) throw new Error("Supabase storage is not configured");
  return { url, serviceRoleKey, bucket };
};

export const uploadTeacherAttendanceSelfie = async ({
  imageBase64,
  imageMimeType,
  path,
}: UploadImageInput) => {
  const config = getTeacherBucketConfig();
  const parsed = parseTeacherSelfie(imageBase64, imageMimeType);
  const objectPath = `${path}.${parsed.extension}`;
  const uploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${objectPath}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
      "Content-Type": parsed.mimeType,
      "Cache-Control": "31536000",
      "x-upsert": "false",
    },
    body: parsed.buffer as unknown as BodyInit,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to upload selfie to Supabase${detail ? `: ${detail}` : ""}`);
  }

  return {
    selfiePath: objectPath,
    selfieUrl: `${config.url}/storage/v1/object/public/${config.bucket}/${objectPath}`,
    selfieMimeType: parsed.mimeType,
    selfieSizeBytes: parsed.sizeBytes,
  };
};

// ─── Notification Image Upload ────────────────────────────────────────────────

export const uploadNotificationImage = async ({
  imageBase64,
  imageMimeType,
  path,
}: UploadImageInput) => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_NOTIFICATION_BUCKET ?? "notification-images";

  console.log(`[Supabase] uploadNotificationImage → bucket: "${bucket}"`);

  if (!url || !serviceRoleKey) {
    console.error("[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    throw new Error("Supabase storage is not configured");
  }

  let parsed: ParsedImage;
  try {
    parsed = parseBase64Image(imageBase64, imageMimeType, NOTIFICATION_IMAGE_MAX_BYTES, "NotificationImage");
  } catch (err: any) {
    console.error("[Supabase] Image parse error:", err?.message);
    throw err;
  }

  const objectPath = `${path}.${parsed.extension}`;
  const uploadUrl = `${url}/storage/v1/object/${bucket}/${objectPath}`;

  console.log(
    `[Supabase] Uploading ${(parsed.sizeBytes / 1024).toFixed(1)} KB (${parsed.mimeType}) → ${uploadUrl}`
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": parsed.mimeType,
      "Cache-Control": "31536000",
      "x-upsert": "true",
    },
    body: parsed.buffer as unknown as BodyInit,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[Supabase] Upload failed (HTTP ${response.status}):`, detail);
    throw new Error(
      `Supabase upload error (HTTP ${response.status}): ${detail || response.statusText}`
    );
  }

  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
  console.log(`[Supabase] Upload success → ${publicUrl}`);

  return {
    imagePath: objectPath,
    imageUrl: publicUrl,
    imageMimeType: parsed.mimeType,
    imageSizeBytes: parsed.sizeBytes,
  };
};

export const uploadExpenseBill = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_EXPENSE_BILL_BUCKET ?? "expense-bills";
  if (!url || !serviceRoleKey) throw new Error("Supabase storage is not configured");
  const parsed = parseBase64Image(imageBase64, imageMimeType, 15 * 1024 * 1024, "ExpenseBill");
  const objectPath = `${path}.${parsed.extension}`;
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, "Content-Type": parsed.mimeType, "Cache-Control": "31536000", "x-upsert": "false" },
    body: parsed.buffer as unknown as BodyInit,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to upload expense bill to Supabase${detail ? `: ${detail}` : ""}`);
  }
  return { billPath: objectPath, billUrl: `${url}/storage/v1/object/public/${bucket}/${objectPath}`, billMimeType: parsed.mimeType };
};

// ─── User Profile Photo Upload (user-profiles bucket) ─────────────────────────

export const uploadUserProfilePhoto = async ({
  imageBase64,
  imageMimeType,
  path,
}: UploadImageInput) => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_USER_PROFILES_BUCKET ?? "user-profiles";

  console.log(`[Supabase] uploadUserProfilePhoto → bucket: "${bucket}"`);

  if (!url || !serviceRoleKey) {
    console.error("[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    throw new Error("Supabase storage is not configured");
  }

  let parsed: ParsedImage;
  try {
    parsed = parseBase64Image(imageBase64, imageMimeType, NOTIFICATION_IMAGE_MAX_BYTES, "ProfilePhoto");
  } catch (err: any) {
    console.error("[Supabase] Profile photo parse error:", err?.message);
    throw err;
  }

  const objectPath = `${path}.${parsed.extension}`;
  const uploadUrl = `${url}/storage/v1/object/${bucket}/${objectPath}`;

  console.log(
    `[Supabase] Uploading profile photo ${(parsed.sizeBytes / 1024).toFixed(1)} KB (${parsed.mimeType}) → ${uploadUrl}`
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": parsed.mimeType,
      "Cache-Control": "31536000",
      "x-upsert": "true",
    },
    body: parsed.buffer as unknown as BodyInit,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[Supabase] Profile photo upload failed (HTTP ${response.status}):`, detail);
    throw new Error(
      `Supabase profile photo upload error (HTTP ${response.status}): ${detail || response.statusText}`
    );
  }

  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
  console.log(`[Supabase] Profile photo upload success → ${publicUrl}`);

  return {
    imagePath: objectPath,
    imageUrl: publicUrl,
    imageMimeType: parsed.mimeType,
    imageSizeBytes: parsed.sizeBytes,
  };
};
