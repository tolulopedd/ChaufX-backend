import { EmailVerificationPurpose, Prisma, UserRole } from "@prisma/client";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { buildSession, createVerifiedCustomer, login, registerCustomer } from "./auth.service.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../common/AppError.js";
import { comparePassword, hashPassword, verifyRefreshToken } from "../../lib/auth.js";
import type { RefreshToken } from "@prisma/client";
import { confirmEmailVerificationToken, issueEmailVerificationToken } from "../../lib/email-verification.js";
import { sendTransactionalEmail } from "../../lib/email.js";
import { env } from "../../config/env.js";
import { issuePasswordResetToken, readPasswordResetToken, resetPasswordWithToken } from "../../lib/password-reset.js";

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false
  }
});

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.email(),
  phone: z.string().min(7).optional(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

const forgotPasswordSchema = z.object({
  email: z.email()
});

const passwordResetValidateSchema = z.object({
  token: z.string().min(20)
});

const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(20),
    password: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match."
  });

const customerVerificationRequestSchema = z.object({
  fullName: z.string().min(2),
  email: z.email(),
  phone: z.string().min(7).optional(),
  password: z.string().min(8)
});

const driverVerificationRequestSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.email()
});

const confirmVerificationSchema = z.object({
  token: z.string().min(20)
});

export const authRoutes = Router();

async function buildAndSendVerificationEmail(params: {
  email: string;
  purpose: EmailVerificationPurpose;
  subject: string;
  payload: Prisma.InputJsonValue;
  firstName: string;
}) {
  const token = await issueEmailVerificationToken({
    email: params.email,
    purpose: params.purpose,
    payload: params.payload
  });

  const verifyUrl = new URL("/verify-email", env.CLIENT_APP_URL);
  verifyUrl.searchParams.set("token", token);

  const emailResult = await sendTransactionalEmail({
    to: params.email,
    subject: params.subject,
    html:
      params.purpose === EmailVerificationPurpose.DRIVER_ONBOARDING
        ? `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.7; max-width: 620px; margin: 0 auto;">
        <p style="margin: 0 0 16px;">Dear ${params.firstName},</p>
        <p style="margin: 0 0 16px;">This email is for your ChaufX Canada driver onboarding.</p>
        <p style="margin: 0 0 16px;">Please verify your email address to continue your onboarding and access the driver application form.</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl.toString()}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">
            Verify email
          </a>
        </p>
        <p style="margin: 0 0 12px;">After verification, you will be taken directly to the onboarding application form.</p>
        <p style="margin: 16px 0 8px;">If the button does not work, copy and paste this link into your browser:</p>
        <p style="margin: 0;"><a href="${verifyUrl.toString()}" target="_blank" rel="noopener noreferrer">${verifyUrl.toString()}</a></p>
      </div>
    `
        : `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.7; max-width: 620px; margin: 0 auto;">
        <p style="margin: 0 0 16px;">Hello ${params.firstName},</p>
        <p style="margin: 0 0 16px;">Welcome to ChaufX Canada.</p>
        <p style="margin: 0 0 16px;">Please verify your email address to finish setting up your customer account and continue with ChaufX.</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl.toString()}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">
            Verify email
          </a>
        </p>
        <p style="margin: 16px 0 8px;">If the button does not work, copy and paste this link into your browser:</p>
        <p style="margin: 0;"><a href="${verifyUrl.toString()}" target="_blank" rel="noopener noreferrer">${verifyUrl.toString()}</a></p>
      </div>
    `,
    text:
      params.purpose === EmailVerificationPurpose.DRIVER_ONBOARDING
        ? `Dear ${params.firstName}, this email is for your ChaufX Canada driver onboarding. Verify your email to continue: ${verifyUrl.toString()}`
        : `Hello ${params.firstName}, welcome to ChaufX Canada. Verify your email to continue: ${verifyUrl.toString()}`
  });

  return {
    previewUrl: emailResult.delivered ? undefined : verifyUrl.toString()
  };
}

authRoutes.post(
  "/auth/verify-email/request/customer",
  authLimiter,
  asyncHandler(async (request, response) => {
    const input = customerVerificationRequestSchema.parse(request.body);

    const existingUser = await prisma.user.findUnique({
      where: {
        email: input.email
      }
    });

    if (existingUser?.emailVerifiedAt) {
      throw new AppError("An account already exists for that email", 409, "EMAIL_EXISTS");
    }

    if (existingUser && existingUser.role !== UserRole.CUSTOMER) {
      throw new AppError("This email is already attached to a different account.", 409, "EMAIL_EXISTS");
    }

    const emailMeta = await buildAndSendVerificationEmail({
      email: input.email,
      purpose: EmailVerificationPurpose.CUSTOMER_SIGNUP,
      subject: "Verify your ChaufX account",
      firstName: input.fullName.trim().split(/\s+/)[0] ?? input.fullName.trim(),
      payload: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash: await hashPassword(input.password)
      }
    });

    response.json({
      message: "A verification link has been sent to your email address.",
      ...emailMeta
    });
  })
);

authRoutes.post(
  "/auth/verify-email/request/driver-onboarding",
  authLimiter,
  asyncHandler(async (request, response) => {
    const input = driverVerificationRequestSchema.parse(request.body);

    const existingUser = await prisma.user.findUnique({
      where: {
        email: input.email
      }
    });

    if (existingUser && existingUser.role !== UserRole.DRIVER) {
      throw new AppError("This email is already attached to a different account.", 409, "EMAIL_EXISTS");
    }

    const emailMeta = await buildAndSendVerificationEmail({
      email: input.email,
      purpose: EmailVerificationPurpose.DRIVER_ONBOARDING,
      subject: "Verify your email to continue onboarding",
      firstName: input.firstName,
      payload: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email
      }
    });

    response.json({
      message: "A verification link has been sent to your email address.",
      ...emailMeta
    });
  })
);

authRoutes.post(
  "/auth/verify-email/confirm",
  authLimiter,
  asyncHandler(async (request, response) => {
    const { token } = confirmVerificationSchema.parse(request.body);
    const verification = await confirmEmailVerificationToken(token);
    const payload = verification.payload as Record<string, string | null> | null;

    if (verification.purpose === EmailVerificationPurpose.CUSTOMER_SIGNUP) {
      if (!payload?.fullName || !payload.email || !payload.passwordHash) {
        throw new AppError("Verification payload is incomplete.", 400, "INVALID_VERIFICATION_PAYLOAD");
      }

      await createVerifiedCustomer({
        fullName: payload.fullName,
        email: payload.email,
        phone: payload.phone ?? undefined,
        passwordHash: payload.passwordHash
      });
    }

    response.json({
      purpose: verification.purpose,
      email: verification.email,
      payload
    });
  })
);

authRoutes.post(
  "/auth/register/customer",
  authLimiter,
  asyncHandler(async (request, response) => {
    const input = registerSchema.parse(request.body);
    const session = await registerCustomer(input);
    response.status(201).json(session);
  })
);

authRoutes.post(
  "/auth/login",
  authLimiter,
  asyncHandler(async (request, response) => {
    const input = loginSchema.parse(request.body);
    const session = await login(input);
    response.json(session);
  })
);

authRoutes.post(
  "/auth/refresh",
  authLimiter,
  asyncHandler(async (request, response) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const payload = verifyRefreshToken(refreshToken);

    const storedTokens = await prisma.refreshToken.findMany({
      where: {
        userId: payload.userId,
        revokedAt: null
      },
      orderBy: { createdAt: "desc" }
    });

    const matchedToken = await Promise.any(
      storedTokens.map(async (tokenRecord: RefreshToken) => {
        const matches = await comparePassword(refreshToken, tokenRecord.tokenHash);
        if (matches) {
          return tokenRecord;
        }
        throw new Error("No match");
      })
    ).catch(() => null);

    if (!matchedToken) {
      throw new AppError("Refresh token is invalid", 401, "INVALID_REFRESH");
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: payload.userId }
    });

    await prisma.refreshToken.update({
      where: { id: matchedToken.id },
      data: { revokedAt: new Date() }
    });

    const session = await buildSession(user);
    response.json(session);
  })
);

authRoutes.post(
  "/auth/forgot-password",
  authLimiter,
  asyncHandler(async (request, response) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (user) {
      const token = await issuePasswordResetToken(user.id);
      const resetUrl = new URL("/reset-password", env.CLIENT_APP_URL);
      resetUrl.searchParams.set("token", token);

      const emailResult = await sendTransactionalEmail({
        to: user.email,
        subject: "Reset your ChaufX password",
        html: `
          <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.7; max-width: 620px; margin: 0 auto;">
            <p style="margin: 0 0 16px;">Hello ${user.fullName.trim().split(/\s+/)[0] ?? user.fullName},</p>
            <p style="margin: 0 0 16px;">We received a request to reset your ChaufX password.</p>
            <p style="margin: 0 0 16px;">Use the secure button below to choose a new password. This link will expire in 1 hour.</p>
            <p style="margin: 24px 0;">
              <a href="${resetUrl.toString()}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">
                Reset password
              </a>
            </p>
            <p style="margin: 16px 0 8px;">If the button does not work, copy and paste this link into your browser:</p>
            <p style="margin: 0 0 16px;"><a href="${resetUrl.toString()}" target="_blank" rel="noopener noreferrer">${resetUrl.toString()}</a></p>
            <p style="margin: 0; color: #64748b;">If you did not request this change, you can safely ignore this email.</p>
          </div>
        `,
        text: `Hello ${user.fullName.trim().split(/\s+/)[0] ?? user.fullName}, reset your ChaufX password here: ${resetUrl.toString()}`
      });

      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "APPLICATION_REVIEWED",
          title: "Password reset requested",
          body: "A password reset link was sent to your email address.",
          channel: "EMAIL",
          status: "SENT",
          meta: emailResult.delivered ? undefined : { previewUrl: resetUrl.toString() }
        }
      });

      response.json({
        message: "If the email exists, a password reset link has been sent.",
        previewUrl: emailResult.delivered ? undefined : resetUrl.toString()
      });
      return;
    }

    response.json({
      message: "If the email exists, a password reset link has been sent."
    });
  })
);

authRoutes.get(
  "/auth/reset-password/validate",
  authLimiter,
  asyncHandler(async (request, response) => {
    const { token } = passwordResetValidateSchema.parse({
      token: paramValue(request.query.token)
    });

    const record = await readPasswordResetToken(token);

    response.json({
      email: record.user.email,
      fullName: record.user.fullName
    });
  })
);

authRoutes.post(
  "/auth/reset-password/confirm",
  authLimiter,
  asyncHandler(async (request, response) => {
    const input = passwordResetConfirmSchema.parse(request.body);
    const user = await resetPasswordWithToken(input.token, input.password);

    response.json({
      message: "Your password has been updated. You can now sign in.",
      email: user.email
    });
  })
);

authRoutes.post(
  "/auth/logout",
  requireAuth,
  asyncHandler(async (request, response) => {
    await prisma.refreshToken.updateMany({
      where: {
        userId: request.auth!.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    response.status(204).send();
  })
);

authRoutes.post(
  "/auth/change-password",
  requireAuth,
  asyncHandler(async (request, response) => {
    const schema = z.object({
      currentPassword: z.string().min(8),
      newPassword: z.string().min(8)
    });
    const input = schema.parse(request.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.auth!.userId }
    });

    const valid = await comparePassword(input.currentPassword, user.passwordHash);

    if (!valid) {
      throw new AppError("Current password is incorrect", 400, "INVALID_PASSWORD");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword)
      }
    });

    response.json({ success: true });
  })
);
