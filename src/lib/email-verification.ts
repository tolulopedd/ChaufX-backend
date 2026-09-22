import { createHash, randomBytes } from "node:crypto";
import { EmailVerificationPurpose, Prisma } from "@prisma/client";
import { AppError } from "../common/AppError.js";
import { prisma } from "./prisma.js";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const DRIVER_APPLICATION_UPDATE_TTL_MS = 48 * 60 * 60 * 1000;
export const DRIVER_ABSTRACT_SUBMISSION_TTL_MS = 48 * 60 * 60 * 1000;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueEmailVerificationToken(params: {
  email: string;
  purpose: EmailVerificationPurpose;
  payload?: Prisma.InputJsonValue;
  ttlMs?: number;
}) {
  const token = randomBytes(32).toString("hex");

  await prisma.emailVerificationToken.deleteMany({
    where: {
      email: params.email,
      purpose: params.purpose,
      usedAt: null
    }
  });

  await prisma.emailVerificationToken.create({
    data: {
      email: params.email,
      purpose: params.purpose,
      tokenHash: tokenHash(token),
      payload: params.payload,
      expiresAt: new Date(Date.now() + (params.ttlMs ?? EMAIL_VERIFICATION_TTL_MS))
    }
  });

  return token;
}

export async function readEmailVerificationToken(rawToken: string) {
  const record = await prisma.emailVerificationToken.findUnique({
    where: {
      tokenHash: tokenHash(rawToken)
    }
  });

  if (!record) {
    throw new AppError("Verification link is invalid.", 400, "INVALID_VERIFICATION_TOKEN");
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError("Verification link has expired. Please request a new one.", 400, "EXPIRED_VERIFICATION_TOKEN");
  }

  return record;
}

export async function confirmEmailVerificationToken(rawToken: string) {
  const record = await readEmailVerificationToken(rawToken);

  if (!record.usedAt) {
    return prisma.emailVerificationToken.update({
      where: {
        id: record.id
      },
      data: {
        usedAt: new Date()
      }
    });
  }

  return record;
}

export async function requireVerifiedEmailToken(params: {
  token: string;
  email: string;
  purpose: EmailVerificationPurpose;
}) {
  const record = await readEmailVerificationToken(params.token);

  if (record.purpose !== params.purpose || record.email.toLowerCase() !== params.email.toLowerCase()) {
    throw new AppError("This verification link does not match the current application.", 400, "VERIFICATION_MISMATCH");
  }

  if (!record.usedAt) {
    throw new AppError("Please verify your email before continuing.", 403, "EMAIL_NOT_VERIFIED");
  }

  return record;
}

export async function requireDriverApplicationUpdateToken(rawToken: string) {
  const record = await readEmailVerificationToken(rawToken);

  if (record.purpose !== EmailVerificationPurpose.DRIVER_APPLICATION_UPDATE) {
    throw new AppError("This application update link is invalid.", 400, "INVALID_APPLICATION_UPDATE_TOKEN");
  }

  if (record.usedAt) {
    throw new AppError("This application update link has already been used.", 400, "USED_APPLICATION_UPDATE_TOKEN");
  }

  const applicationId =
    record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
      ? (record.payload as { applicationId?: unknown }).applicationId
      : undefined;

  if (typeof applicationId !== "string" || !applicationId) {
    throw new AppError("This application update link is invalid.", 400, "INVALID_APPLICATION_UPDATE_TOKEN");
  }

  return { record, applicationId };
}

export async function requireDriverAbstractSubmissionToken(rawToken: string) {
  const record = await readEmailVerificationToken(rawToken);

  if (record.purpose !== EmailVerificationPurpose.DRIVER_ABSTRACT_SUBMISSION) {
    throw new AppError("This driver abstract link is invalid.", 400, "INVALID_DRIVER_ABSTRACT_TOKEN");
  }

  if (record.usedAt) {
    throw new AppError("This driver abstract link has already been used.", 400, "USED_DRIVER_ABSTRACT_TOKEN");
  }

  const applicationId =
    record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
      ? (record.payload as { applicationId?: unknown }).applicationId
      : undefined;

  if (typeof applicationId !== "string" || !applicationId) {
    throw new AppError("This driver abstract link is invalid.", 400, "INVALID_DRIVER_ABSTRACT_TOKEN");
  }

  return { record, applicationId };
}

export async function consumeEmailVerificationToken(tokenId: string) {
  await prisma.emailVerificationToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() }
  });
}
