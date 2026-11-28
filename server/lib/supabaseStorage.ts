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
  if (!buffer.length || buffer.length > HOMEWORK_FILE_MAX_BYTES) throw new Error("Each homework attachment must be 5 MB or smaller");
  return { buffer, mimeType, extension, sizeBytes: buffer.length };
};

type StorageBucket = "SUPABASE_HOMEWORK_BUCKET" | "SUPABASE_TEACHER_ATTENDANCE_BUCKET" |
  "SUPABASE_NOTIFICATION_BUCKET" | "SUPABASE_EXPENSE_BILL_BUCKET" | "SUPABASE_USER_PROFILES_BUCKET";

const uploadParsedFile = async (
  parsed: ParsedDocument,
  path: string,
  bucketVariable: StorageBucket,
  fallbackBucket: string,
  upsert = false,
) => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env[bucketVariable] || fallbackBucket;
  if (!url || !serviceRoleKey) throw new Error("Supabase storage is not configured");
  const objectPath = `${path}.${parsed.extension}`;
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": parsed.mimeType,
      "Cache-Control": "31536000",
      "x-upsert": String(upsert),
    },
    body: parsed.buffer as unknown as BodyInit,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase upload failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return {
    objectPath,
    publicUrl: `${url}/storage/v1/object/public/${bucket}/${objectPath}`,
  };
};

export const uploadHomeworkFile = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const parsed = parseBase64Document(imageBase64, imageMimeType);
  const uploaded = await uploadParsedFile(parsed, path, "SUPABASE_HOMEWORK_BUCKET", "homework");
  return { name: uploaded.objectPath.split("/").pop() || uploaded.objectPath, url: uploaded.publicUrl,
    path: uploaded.objectPath, mimeType: parsed.mimeType, sizeBytes: parsed.sizeBytes };
};

export const parseTeacherSelfie = (imageBase64?: unknown, imageMimeType?: unknown): ParsedImage =>
  parseBase64Image(imageBase64, imageMimeType, TEACHER_SELFIE_MAX_BYTES, "TeacherSelfie");

export const uploadTeacherAttendanceSelfie = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const parsed = parseTeacherSelfie(imageBase64, imageMimeType);
  const uploaded = await uploadParsedFile(parsed, path, "SUPABASE_TEACHER_ATTENDANCE_BUCKET", "teacher-attendance");
  return { selfiePath: uploaded.objectPath, selfieUrl: uploaded.publicUrl,
    selfieMimeType: parsed.mimeType, selfieSizeBytes: parsed.sizeBytes };
};

export const uploadNotificationImage = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const parsed = parseBase64Image(imageBase64, imageMimeType, NOTIFICATION_IMAGE_MAX_BYTES, "NotificationImage");
  const uploaded = await uploadParsedFile(parsed, path, "SUPABASE_NOTIFICATION_BUCKET", "notification-images", true);
  return { imagePath: uploaded.objectPath, imageUrl: uploaded.publicUrl,
    imageMimeType: parsed.mimeType, imageSizeBytes: parsed.sizeBytes };
};

export const uploadExpenseBill = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const parsed = parseBase64Image(imageBase64, imageMimeType, 15 * 1024 * 1024, "ExpenseBill");
  const uploaded = await uploadParsedFile(parsed, path, "SUPABASE_EXPENSE_BILL_BUCKET", "expense-bills");
  return { billPath: uploaded.objectPath, billUrl: uploaded.publicUrl, billMimeType: parsed.mimeType };
};

export const uploadUserProfilePhoto = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const parsed = parseBase64Image(imageBase64, imageMimeType, NOTIFICATION_IMAGE_MAX_BYTES, "ProfilePhoto");
  const uploaded = await uploadParsedFile(parsed, path, "SUPABASE_USER_PROFILES_BUCKET", "user-profiles", true);
  return { imagePath: uploaded.objectPath, imageUrl: uploaded.publicUrl,
    imageMimeType: parsed.mimeType, imageSizeBytes: parsed.sizeBytes };
};
