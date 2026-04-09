import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const storageRoot = fileURLToPath(new URL("../../storage/driver-documents", import.meta.url));

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

  const directory = path.join(storageRoot, options.applicationId);
  await mkdir(directory, { recursive: true });

  const parsed = parseDataUrl(options.fileUrl);
  const safeBaseName = sanitizeFileName(path.parse(options.fileName).name || "document");
  const extension = path.extname(options.fileName) || extensionFromMimeType(options.mimeType || parsed.mimeType);
  const storedName = `${safeBaseName}-${randomUUID()}${extension}`;
  const absolutePath = path.join(directory, storedName);

  await writeFile(absolutePath, parsed.buffer);

  return {
    fileUrl: absolutePath,
    mimeType: options.mimeType || parsed.mimeType
  };
}
