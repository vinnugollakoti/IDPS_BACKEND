type ParsedImage = {
  buffer: Buffer;
  mimeType: string;
  extension: "jpg" | "png" | "webp";
  sizeBytes: number;
};

type UploadImageInput = {
  imageBase64: string;
  imageMimeType?: string;
  path: string;
};

const SUPPORTED_MIME_TYPES: Record<string, ParsedImage["extension"]> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_IMAGE_BYTES = Number(process.env.TEACHER_ATTENDANCE_MAX_IMAGE_BYTES ?? 5 * 1024 * 1024);

const matchesImageSignature = (buffer: Buffer, mimeType: string) => {
  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  }

  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }

  return false;
};

const getSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_TEACHER_ATTENDANCE_BUCKET ?? "teacher-attendance";

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase storage is not configured");
  }

  return { url, serviceRoleKey, bucket };
};

export const parseTeacherSelfie = (imageBase64?: unknown, imageMimeType?: unknown): ParsedImage => {
  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    throw new Error("imageBase64 is required");
  }

  const trimmedImage = imageBase64.trim();
  const dataUrlMatch = trimmedImage.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  const mimeType = dataUrlMatch?.[1] ?? (typeof imageMimeType === "string" ? imageMimeType.trim().toLowerCase() : "");
  const base64Payload = (dataUrlMatch?.[2] ?? trimmedImage).replace(/\s/g, "");
  const extension = SUPPORTED_MIME_TYPES[mimeType];

  if (!extension) {
    throw new Error("Only JPEG, PNG, and WEBP selfie images are supported");
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Payload)) {
    throw new Error("imageBase64 must be a valid base64 encoded image");
  }

  const buffer = Buffer.from(base64Payload, "base64");
  if (!buffer.length) {
    throw new Error("imageBase64 must not be empty");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Selfie image must be ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB or smaller`);
  }

  if (!matchesImageSignature(buffer, mimeType)) {
    throw new Error("Selfie image content does not match the declared image type");
  }

  return {
    buffer,
    mimeType,
    extension,
    sizeBytes: buffer.length,
  };
};

export const uploadTeacherAttendanceSelfie = async ({ imageBase64, imageMimeType, path }: UploadImageInput) => {
  const config = getSupabaseConfig();
  const parsedImage = parseTeacherSelfie(imageBase64, imageMimeType);
  const objectPath = `${path}.${parsedImage.extension}`;
  const uploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${objectPath}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
      "Content-Type": parsedImage.mimeType,
      "Cache-Control": "31536000",
      "x-upsert": "false",
    },
    body: parsedImage.buffer as unknown as BodyInit,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to upload selfie to Supabase${detail ? `: ${detail}` : ""}`);
  }

  return {
    selfiePath: objectPath,
    selfieUrl: `${config.url}/storage/v1/object/public/${config.bucket}/${objectPath}`,
    selfieMimeType: parsedImage.mimeType,
    selfieSizeBytes: parsedImage.sizeBytes,
  };
};
