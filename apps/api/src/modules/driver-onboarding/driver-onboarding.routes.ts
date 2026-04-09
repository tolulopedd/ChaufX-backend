import { AccountStatus, EmailVerificationPurpose, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/auth.js";
import { createAuditLog } from "../../lib/audit.js";
import { persistDriverApplicationDocument } from "../../lib/document-storage.js";
import { requireVerifiedEmailToken } from "../../lib/email-verification.js";

function isDocumentReference(value: string) {
  if (value.startsWith("data:")) {
    return true;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const documentSchema = z.object({
  type: z.enum(["DRIVER_LICENSE", "ID_CARD", "PASSPORT_PHOTO", "BACKGROUND_CHECK", "OTHER"]),
  fileName: z.string().min(2),
  fileUrl: z.string().min(5).refine(isDocumentReference, {
    message: "Document upload must be a valid URL or uploaded file payload."
  }),
  mimeType: z.string().optional()
});

const onboardingSchema = z.object({
  verificationToken: z.string().min(20),
  fullName: z.string().min(2),
  phone: z.string().min(7),
  email: z.email(),
  password: z.string().min(8).optional(),
  address: z.string().min(5),
  licenseNumber: z.string().min(5),
  yearsOfExperience: z.coerce.number().int().min(0),
  emergencyContact: z.string().min(2).optional(),
  preferredServiceAreas: z.array(z.string()).default([]),
  availabilitySchedule: z.string().optional(),
  documents: z.array(documentSchema).default([])
});

export const driverOnboardingRoutes = Router();

driverOnboardingRoutes.post(
  "/driver-onboarding/apply",
  asyncHandler(async (request, response) => {
    const input = onboardingSchema.parse(request.body);

    await requireVerifiedEmailToken({
      token: input.verificationToken,
      email: input.email,
      purpose: EmailVerificationPurpose.DRIVER_ONBOARDING
    });

    const existingUser = await prisma.user.findUnique({
      where: { email: input.email }
    });

    if (existingUser && existingUser.role !== UserRole.DRIVER) {
      response.status(409).json({
        error: {
          code: "EMAIL_EXISTS",
          message: "This email is already attached to a different account."
        }
      });
      return;
    }

    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          passwordHash: await hashPassword(input.password ?? `DriveMe-${randomUUID()}`),
          role: UserRole.DRIVER,
          status: AccountStatus.PENDING_APPROVAL,
          emailVerifiedAt: new Date()
        }
      }));

    if (!user.emailVerifiedAt) {
      await prisma.user.update({
        where: {
          id: user.id
        },
        data: {
          emailVerifiedAt: new Date()
        }
      });
    }

    const application = await prisma.driverApplication.upsert({
      where: {
        userId: user.id
      },
      create: {
        userId: user.id,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        address: input.address,
        licenseNumber: input.licenseNumber,
        yearsOfExperience: input.yearsOfExperience,
        emergencyContact: input.emergencyContact ?? "Not provided",
        preferredServiceAreas: input.preferredServiceAreas,
        availabilitySchedule: input.availabilitySchedule
      },
      update: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        address: input.address,
        licenseNumber: input.licenseNumber,
        yearsOfExperience: input.yearsOfExperience,
        emergencyContact: input.emergencyContact ?? "Not provided",
        preferredServiceAreas: input.preferredServiceAreas,
        availabilitySchedule: input.availabilitySchedule,
        status: "SUBMITTED",
        reviewNote: null,
        reviewedAt: null
      },
      include: {
        documents: true
      }
    });

    const storedDocuments = await Promise.all(
      input.documents.map(async (document) => {
        const stored = await persistDriverApplicationDocument({
          applicationId: application.id,
          fileName: document.fileName,
          fileUrl: document.fileUrl,
          mimeType: document.mimeType
        });

        return {
          type: document.type,
          fileName: document.fileName,
          fileUrl: stored.fileUrl,
          mimeType: stored.mimeType
        };
      })
    );

    const applicationWithDocuments = await prisma.driverApplication.update({
      where: {
        id: application.id
      },
      data: {
        documents: {
          deleteMany: {},
          create: storedDocuments
        }
      },
      include: {
        documents: true
      }
    });

    await createAuditLog({
      action: "DRIVER_APPLICATION_SUBMITTED",
      entityType: "DriverApplication",
      entityId: applicationWithDocuments.id,
      actorId: user.id
    });

    response.status(201).json(applicationWithDocuments);
  })
);

driverOnboardingRoutes.get(
  "/driver-onboarding/status",
  asyncHandler(async (request, response) => {
    const query = z.object({
      email: z.email()
    }).parse({ email: paramValue(request.query.email) });

    const application = await prisma.driverApplication.findFirst({
      where: {
        email: query.email
      },
      include: {
        documents: true
      }
    });

    response.json(application);
  })
);
