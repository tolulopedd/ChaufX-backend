import { EmailVerificationPurpose, Prisma, UserRole } from "@prisma/client";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { buildSession, createVerifiedCustomer, login, registerCustomer } from "./auth.service.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../common/AppError.js";
import { comparePassword, hashPassword, verifyRefreshToken } from "../../lib/auth.js";
import type { RefreshToken } from "@prisma/client";
import { confirmEmailVerificationToken, issueEmailVerificationToken } from "../../lib/email-verification.js";
import { sendTransactionalEmail } from "../../lib/email.js";
import { env } from "../../config/env.js";

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
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
        <p>Hello,</p>
        <p>Please verify your email to continue with DriveMe.</p>
        <p>
          <a href="${verifyUrl.toString()}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">
            Verify email
          </a>
        </p>
        <p>If the button does not work, copy and paste this link into your browser:</p>
        <p><a href="${verifyUrl.toString()}">${verifyUrl.toString()}</a></p>
      </div>
    `,
    text: `Please verify your email to continue with DriveMe: ${verifyUrl.toString()}`
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
      subject: "Verify your DriveMe account",
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
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "APPLICATION_REVIEWED",
          title: "Password reset requested",
          body: "A password reset was requested. Implement your provider flow here.",
          channel: "EMAIL",
          status: "SENT"
        }
      });
    }

    response.json({
      message: "If the email exists, a reset notification has been queued."
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
