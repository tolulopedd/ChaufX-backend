import {
  AccountStatus,
  DriverApplicationReviewAuthor,
  DriverApplicationReviewEvent,
  EmailVerificationPurpose,
  UserRole
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/auth.js";
import { createAuditLog } from "../../lib/audit.js";
import { persistDriverApplicationDocument } from "../../lib/document-storage.js";
import { AppError } from "../../common/AppError.js";
import {
  consumeEmailVerificationToken,
  requireDriverApplicationUpdateToken,
  requireVerifiedEmailToken
} from "../../lib/email-verification.js";

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
  verificationToken: z.string().min(20).optional(),
  applicationUpdateToken: z.string().min(20).optional(),
  fullName: z.string().min(2),
  phone: z.string().min(7),
  email: z.email(),
  password: z.string().min(8).optional(),
  address: z.string().min(5),
  licenseNumber: z.string().min(5),
  yearsOfExperience: z.coerce.number().int().min(2),
  emergencyContact: z.string().min(2).optional(),
  preferredServiceAreas: z.array(z.string().trim().min(2)).min(1),
  availabilitySchedule: z.string().optional(),
  applicantResponse: z.string().trim().min(2).max(4000).optional(),
  replaceDocumentIds: z.array(z.string().uuid()).default([]),
  documents: z.array(documentSchema).default([])
}).superRefine((input, context) => {
  if (!input.verificationToken && !input.applicationUpdateToken) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A verified application link is required." });
  }
  if (input.verificationToken && input.applicationUpdateToken) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Only one application link may be used." });
  }
  if (input.applicationUpdateToken && !input.applicantResponse) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["applicantResponse"], message: "Please respond to the admin comment before resubmitting." });
  }
});

export const driverOnboardingRoutes = Router();

driverOnboardingRoutes.post(
  "/driver-onboarding/apply",
  asyncHandler(async (request, response) => {
    const input = onboardingSchema.parse(request.body);
    const applicationUpdate = input.applicationUpdateToken
      ? await requireDriverApplicationUpdateToken(input.applicationUpdateToken)
      : null;

    if (!applicationUpdate) {
      await requireVerifiedEmailToken({
        token: input.verificationToken!,
        email: input.email,
        purpose: EmailVerificationPurpose.DRIVER_ONBOARDING
      });
    }

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

    const existingApplication = applicationUpdate
      ? await prisma.driverApplication.findUnique({
        where: { id: applicationUpdate.applicationId },
        include: { documents: true }
      })
      : null;

    if (applicationUpdate) {
      if (!existingApplication || existingApplication.userId !== existingUser?.id || existingApplication.email.toLowerCase() !== input.email.toLowerCase()) {
        throw new AppError("This application update link does not match the current application.", 400, "APPLICATION_UPDATE_MISMATCH");
      }

      if (existingApplication.status !== "UNDER_REVIEW") {
        throw new AppError("This application is not currently awaiting additional information.", 400, "APPLICATION_NOT_AWAITING_UPDATE");
      }

      const originalDocumentIds = new Set(existingApplication.documents.map((document) => document.id));
      if (input.replaceDocumentIds.some((documentId) => !originalDocumentIds.has(documentId))) {
        throw new AppError("A selected document does not belong to this application.", 400, "INVALID_DOCUMENT_REPLACEMENT");
      }
    }

    const user =
      existingUser ??
      (await prisma.user.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          passwordHash: await hashPassword(input.password ?? `ChaufX-${randomUUID()}`),
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
        availabilitySchedule: input.availabilitySchedule,
        driverAbstractInitiatedAt: new Date()
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
        reviewNote: applicationUpdate ? undefined : null,
        applicantResponse: applicationUpdate ? input.applicantResponse : null,
        reviewedAt: null,
        backgroundCheckComment: null,
        driverAbstractInitiatedAt: applicationUpdate ? undefined : new Date(),
        criminalCheckInvitedAt: applicationUpdate ? undefined : null,
        criminalCheckInvitedByUserId: applicationUpdate ? undefined : null
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
          ...(applicationUpdate
            ? input.replaceDocumentIds.length > 0
              ? { deleteMany: { id: { in: input.replaceDocumentIds } } }
              : {}
            : { deleteMany: {} }),
          ...(storedDocuments.length > 0 ? { create: storedDocuments } : {})
        }
      },
      include: {
        documents: true
      }
    });

    if (applicationUpdate && input.applicantResponse) {
      await prisma.driverApplicationReviewHistory.create({
        data: {
          applicationId: applicationWithDocuments.id,
          author: DriverApplicationReviewAuthor.DRIVER,
          event: DriverApplicationReviewEvent.APPLICATION_RESUBMITTED,
          note: input.applicantResponse
        }
      });
    }

    await createAuditLog({
      action: applicationUpdate ? "DRIVER_APPLICATION_RESUBMITTED" : "DRIVER_APPLICATION_SUBMITTED",
      entityType: "DriverApplication",
      entityId: applicationWithDocuments.id,
      actorId: user.id
    });

    if (applicationUpdate) {
      await consumeEmailVerificationToken(applicationUpdate.record.id);
    }

    response.status(201).json(applicationWithDocuments);
  })
);

driverOnboardingRoutes.get(
  "/driver-onboarding/application-update",
  asyncHandler(async (request, response) => {
    const query = z.object({ token: z.string().min(20) }).parse({ token: paramValue(request.query.token) });
    const update = await requireDriverApplicationUpdateToken(query.token);
    const application = await prisma.driverApplication.findUnique({
      where: { id: update.applicationId },
      select: {
        fullName: true,
        phone: true,
        email: true,
        address: true,
        licenseNumber: true,
        yearsOfExperience: true,
        emergencyContact: true,
        preferredServiceAreas: true,
        availabilitySchedule: true,
        reviewNote: true,
        documents: { select: { id: true, fileName: true, type: true } }
      }
    });

    if (!application || application.email.toLowerCase() !== update.record.email.toLowerCase()) {
      throw new AppError("This application update link is invalid.", 400, "INVALID_APPLICATION_UPDATE_TOKEN");
    }

    response.json(application);
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
