import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../common/AppError.js";

const storageRoot = fileURLToPath(new URL("../../storage/driver-documents", import.meta.url));
const s3Protocol = "s3://";

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizeMetadataFileName(fileName: string) {
  return sanitizeFileName(fileName) || "document";
}

function extensionFromMimeType(mimeType?: string) {
  if (!mimeType) {
    return "";
  }

  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType === "image/png") {
    return ".png";
  }

  if (mimeType === "image/jpeg") {
    return ".jpg";
  }

  if (mimeType === "image/webp") {
    return ".webp";
  }

  return "";
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);

  if (!match) {
    throw new Error("Invalid uploaded document payload.");
  }

  return {
    mimeType: match[1] || undefined,
    buffer: Buffer.from(match[2], "base64")
  };
}

function hasS3Config() {
  return Boolean(env.AWS_REGION && env.AWS_S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

let cachedS3Client: S3Client | null = null;

function getS3Client() {
  if (!hasS3Config()) {
    return null;
  }

  if (!cachedS3Client) {
    cachedS3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!
      }
    });
  }

  return cachedS3Client;
}

function buildStorageName(fileName: string, mimeType?: string) {
  const safeBaseName = sanitizeFileName(path.parse(fileName).name || "document");
  const extension = path.extname(fileName) || extensionFromMimeType(mimeType);
  return `${safeBaseName}-${randomUUID()}${extension}`;
}

function buildS3Key(prefix: string, entityId: string, fileName: string, mimeType?: string) {
  return `${prefix.replace(/^\/+|\/+$/g, "")}/${entityId}/${buildStorageName(fileName, mimeType)}`;
}

function buildS3Reference(bucket: string, key: string) {
  return `${s3Protocol}${bucket}/${key}`;
}

function parseS3Reference(fileUrl: string) {
  if (!fileUrl.startsWith(s3Protocol)) {
    return null;
  }

  const withoutProtocol = fileUrl.slice(s3Protocol.length);
  const firstSlash = withoutProtocol.indexOf("/");

  if (firstSlash === -1) {
    throw new Error("Invalid S3 document reference.");
  }

  return {
    bucket: withoutProtocol.slice(0, firstSlash),
    key: withoutProtocol.slice(firstSlash + 1)
  };
}

export function isS3DocumentReference(fileUrl: string) {
  return fileUrl.startsWith(s3Protocol);
}

export async function persistDriverApplicationDocument(options: {
  applicationId: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string;
}) {
  if (!options.fileUrl.startsWith("data:")) {
    return {
      fileUrl: options.fileUrl,
      mimeType: options.mimeType
    };
  }

  const parsed = parseDataUrl(options.fileUrl);
  const mimeType = options.mimeType || parsed.mimeType;

  const s3Client = getS3Client();
  if (s3Client && env.AWS_S3_BUCKET) {
    const key = buildS3Key(env.AWS_S3_DOCUMENT_PREFIX, options.applicationId, options.fileName, mimeType);

    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: env.AWS_S3_BUCKET,
          Key: key,
          Body: parsed.buffer,
          ContentType: mimeType,
          Metadata: {
            // S3 metadata becomes HTTP headers, which must use ASCII-safe values.
            originalFileName: sanitizeMetadataFileName(options.fileName)
          }
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown S3 upload error";
      throw new AppError(
        `Unable to upload driver documents to secure storage. (${message})`,
        500,
        "DOCUMENT_STORAGE_UPLOAD_FAILED"
      );
    }

    return {
      fileUrl: buildS3Reference(env.AWS_S3_BUCKET, key),
      mimeType
    };
  }

  const directory = path.join(storageRoot, options.applicationId);
  await mkdir(directory, { recursive: true });

  const absolutePath = path.join(directory, buildStorageName(options.fileName, mimeType));
  await writeFile(absolutePath, parsed.buffer);

  return {
    fileUrl: absolutePath,
    mimeType
  };
}

export async function persistCustomerIdentityDocument(options: {
  customerProfileId: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string;
}) {
  if (!options.fileUrl.startsWith("data:")) {
    throw new AppError("Government photo ID must be uploaded from the ChaufX app.", 400, "INVALID_ID_DOCUMENT");
  }

  const parsed = parseDataUrl(options.fileUrl);
  const mimeType = options.mimeType || parsed.mimeType;
  const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

  if (!mimeType || !allowedMimeTypes.has(mimeType)) {
    throw new AppError("Upload a JPG, PNG, WEBP, HEIC, or PDF government photo ID.", 400, "INVALID_ID_DOCUMENT_TYPE");
  }

  if (parsed.buffer.length > 7 * 1024 * 1024) {
    throw new AppError("Government photo ID files must be 7 MB or smaller.", 400, "ID_DOCUMENT_TOO_LARGE");
  }

  const s3Client = getS3Client();
  if (!s3Client || !env.AWS_S3_BUCKET) {
    throw new AppError(
      "Government photo ID uploads are not configured yet. Please contact ChaufX support.",
      503,
      "ID_DOCUMENT_STORAGE_UNAVAILABLE"
    );
  }

  const key = buildS3Key(env.AWS_S3_CUSTOMER_DOCUMENT_PREFIX, options.customerProfileId, options.fileName, mimeType);

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.AWS_S3_BUCKET,
        Key: key,
        Body: parsed.buffer,
        ContentType: mimeType,
        Metadata: {
          originalFileName: sanitizeMetadataFileName(options.fileName),
          documentType: "government-photo-id"
        }
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown S3 upload error";
    throw new AppError(`Unable to store government photo ID securely. (${message})`, 500, "ID_DOCUMENT_STORAGE_UPLOAD_FAILED");
  }

  return {
    fileUrl: buildS3Reference(env.AWS_S3_BUCKET, key),
    mimeType
  };
}

export async function createDocumentAccessUrl(fileUrl: string) {
  const s3Reference = parseS3Reference(fileUrl);
  if (!s3Reference) {
    return null;
  }

  const s3Client = getS3Client();
  if (!s3Client) {
    throw new Error("AWS S3 is not configured for this environment.");
  }

  return await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: s3Reference.bucket,
      Key: s3Reference.key
    }),
    { expiresIn: 60 * 5 }
  );
}
