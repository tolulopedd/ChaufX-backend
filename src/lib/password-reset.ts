import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../common/AppError.js";
import { hashPassword } from "./auth.js";
import { prisma } from "./prisma.js";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issuePasswordResetToken(userId: string) {
  const token = randomBytes(32).toString("hex");

  await prisma.passwordResetToken.deleteMany({
    where: {
      userId,
      usedAt: null
    }
  });

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS)
    }
  });

  return token;
}

export async function readPasswordResetToken(rawToken: string) {
  const record = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash: tokenHash(rawToken)
    },
    include: {
      user: true
    }
  });

  if (!record) {
    throw new AppError("Password reset link is invalid.", 400, "INVALID_PASSWORD_RESET_TOKEN");
  }

  if (record.usedAt) {
    throw new AppError("This password reset link has already been used.", 400, "USED_PASSWORD_RESET_TOKEN");
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new AppError("Password reset link has expired. Please request a new one.", 400, "EXPIRED_PASSWORD_RESET_TOKEN");
  }

  return record;
}

export async function resetPasswordWithToken(rawToken: string, newPassword: string) {
  const record = await readPasswordResetToken(rawToken);
  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: record.userId
      },
      data: {
        passwordHash
      }
    }),
    prisma.passwordResetToken.update({
      where: {
        id: record.id
      },
      data: {
        usedAt: new Date()
      }
    }),
    prisma.refreshToken.updateMany({
      where: {
        userId: record.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    })
  ]);

  return record.user;
}
