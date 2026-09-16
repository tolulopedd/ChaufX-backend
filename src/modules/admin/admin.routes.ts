import {
  AccountStatus,
  BookingStatus,
  MembershipBillingCycle,
  MembershipStatus,
  MembershipTier,
  PaymentStatus,
  TripStatus,
  UserRole,
  type Prisma
} from "@prisma/client";
import { Router, type Response } from "express";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createAuditLog } from "../../lib/audit.js";
import { AppError } from "../../common/AppError.js";
import { createDocumentAccessUrl, isS3DocumentReference } from "../../lib/document-storage.js";
import { sendTransactionalEmail } from "../../lib/email.js";
import { env } from "../../config/env.js";
import { hashPassword } from "../../lib/auth.js";

export const adminRoutes = Router();

adminRoutes.use(requireAuth, requireRole(["admin"]));

const canadaRegions = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon"
] as const;

const provincePricingPrefix = "PROVINCE::";
const cityPricingPrefix = "CITY::";
const fallbackPricingPrefix = "FALLBACK::";
const settlementConfigPrefix = "SETTLEMENT::";
const platformSharePercentCode = `${settlementConfigPrefix}PLATFORM_SHARE_PERCENT`;
const fallbackFlatFeeCode = `${fallbackPricingPrefix}FLAT_FEE`;
const fallbackMinHoursCode = `${fallbackPricingPrefix}MIN_HOURS`;
const tritonCriminalCheckEnglishUrl = "https://secure.tritoncanada.ca/Eiv/InitiateEiv?id=c01c17a3-10f6-fdfd-f460-831fb25a3dc7&language=en";
const tritonCriminalCheckFrenchUrl = "https://secure.tritoncanada.ca/Eiv/InitiateEiv?id=c01c17a3-10f6-fdfd-f460-831fb25a3dc7&language=fr";

function disableResponseCache(response: Response) {
  response.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.set("Pragma", "no-cache");
  response.set("Expires", "0");
}

function firstNameFromFullName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

function buildDriverAvailabilitySummary(rawAvailabilitySchedule?: string | null) {
  const rawValue = String(rawAvailabilitySchedule ?? "").trim();
  if (!rawValue) {
    return null;
  }

  const details = Object.fromEntries(
    rawValue
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator === -1) {
          return [line, ""];
        }

        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  ) as Record<string, string>;

  const preferredWorkingHours = details["Preferred working hours"];
  const weeklyAvailability = details["Availability per week"];

  if (!preferredWorkingHours && !weeklyAvailability) {
    return rawValue.length <= 240 ? rawValue : null;
  }

  return [
    preferredWorkingHours ? `Preferred working hours: ${preferredWorkingHours}` : null,
    weeklyAvailability ? `Availability per week: ${weeklyAvailability}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDriverApplicationStatusEmail(params: {
  decision: "approved" | "rejected" | "additional_info";
  fullName: string;
  email: string;
  note: string;
}) {
  const firstName = firstNameFromFullName(params.fullName);
  const statusUrl = new URL("/driver/status", env.CLIENT_APP_URL);
  statusUrl.searchParams.set("email", params.email);
  const loginUrl = new URL("/driver/login", env.CLIENT_APP_URL);

  if (params.decision === "approved") {
    return {
      subject: "Your ChaufX Canada driver application has been approved",
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.7; max-width: 620px; margin: 0 auto;">
          <p style="margin: 0 0 16px;">Dear ${firstName},</p>
          <p style="margin: 0 0 16px;">Your ChaufX Canada driver application has been approved.</p>
          <p style="margin: 0 0 16px;">${params.note}</p>
          <p style="margin: 24px 0;">
            <a href="${loginUrl.toString()}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">
              Go to driver login
            </a>
          </p>
          <p style="margin: 0 0 12px;">You can also review your onboarding status here:</p>
          <p style="margin: 0;"><a href="${statusUrl.toString()}" target="_blank" rel="noopener noreferrer">${statusUrl.toString()}</a></p>
        </div>
      `,
      text: `Dear ${firstName}, your ChaufX Canada driver application has been approved. ${params.note} Driver login: ${loginUrl.toString()} Status page: ${statusUrl.toString()}`
    };
  }

  if (params.decision === "additional_info") {
    return {
      subject: "Additional information is required for your ChaufX Canada application",
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.7; max-width: 620px; margin: 0 auto;">
          <p style="margin: 0 0 16px;">Dear ${firstName},</p>
          <p style="margin: 0 0 16px;">Additional information is required to continue reviewing your ChaufX Canada driver application.</p>
          <p style="margin: 0 0 16px;">${params.note}</p>
          <p style="margin: 24px 0;">
            <a href="${statusUrl.toString()}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">
              Check application status
            </a>
          </p>
          <p style="margin: 0;">Please review the note above and follow the next steps shared by the ChaufX team.</p>
        </div>
      `,
      text: `Dear ${firstName}, additional information is required to continue reviewing your ChaufX Canada driver application. ${params.note} Status page: ${statusUrl.toString()}`
    };
  }

  return {
    subject: "Update on your ChaufX Canada driver application",
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.7; max-width: 620px; margin: 0 auto;">
        <p style="margin: 0 0 16px;">Dear ${firstName},</p>
        <p style="margin: 0 0 16px;">There is an update on your ChaufX Canada driver application.</p>
        <p style="margin: 0 0 16px;">${params.note}</p>
        <p style="margin: 24px 0;">
          <a href="${statusUrl.toString()}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">
            Check application status
          </a>
        </p>
      </div>
    `,
    text: `Dear ${firstName}, there is an update on your ChaufX Canada driver application. ${params.note} Status page: ${statusUrl.toString()}`
  };
}

function buildCriminalCheckInvitationEmail(params: { fullName: string; note: string }) {
  const firstName = firstNameFromFullName(params.fullName);

  return {
    subject: "Continue your ChaufX criminal record verification",
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.7; max-width: 620px; margin: 0 auto;">
        <p style="margin: 0 0 16px;">Dear ${firstName},</p>
        <p style="margin: 0 0 16px;">Your driver abstract review is complete. Please continue with your <strong>Criminal Record and</strong> judicial matters check.</p>
        <p style="margin: 0 0 16px;">${params.note}</p>
        <p style="margin: 24px 0 12px;">Choose your preferred language:</p>
        <p style="margin: 0 0 12px;">
          <a href="${tritonCriminalCheckEnglishUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">Continue in English</a>
        </p>
        <p style="margin: 0;">
          <a href="${tritonCriminalCheckFrenchUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">Continuer en français</a>
        </p>
        <p style="margin: 24px 0 0;">Regards,<br />ChaufX Team</p>
      </div>
    `,
    text: `Dear ${firstName}, your driver abstract review is complete. Please continue with your Criminal Record and judicial matters check. ${params.note} English: ${tritonCriminalCheckEnglishUrl} French: ${tritonCriminalCheckFrenchUrl}\n\nRegards,\nChaufX Team`
  };
}

function encodePricingKeyPart(value: string) {
  return encodeURIComponent(value.trim());
}

function decodePricingKeyPart(value: string) {
  return decodeURIComponent(value);
}

function buildProvincePricingCode(province: string, kind: "FLAT_FEE" | "MIN_HOURS") {
  return `${provincePricingPrefix}${encodePricingKeyPart(province)}::${kind}`;
}

function buildCityPricingCode(province: string, city: string, kind: "FLAT_FEE" | "MIN_HOURS") {
  return `${cityPricingPrefix}${encodePricingKeyPart(province)}::${encodePricingKeyPart(city)}::${kind}`;
}

function parseProvincePricing(settings: Array<{ code: string; value: number }>) {
  const map = new Map<string, { province: string; flatFee: number; minHours: number }>();

  for (const setting of settings) {
    if (!setting.code.startsWith(provincePricingPrefix)) {
      continue;
    }

    const [, encodedProvince, kind] = setting.code.split("::");
    const province = decodePricingKeyPart(encodedProvince);
    const current = map.get(province) ?? { province, flatFee: 29, minHours: 2 };

    if (kind === "FLAT_FEE") {
      current.flatFee = setting.value;
    }

    if (kind === "MIN_HOURS") {
      current.minHours = setting.value;
    }

    map.set(province, current);
  }

  return canadaRegions.map((province) => map.get(province) ?? { province, flatFee: 29, minHours: 2 });
}

function parseCityPricing(settings: Array<{ code: string; value: number }>) {
  const map = new Map<string, { province: string; city: string; flatFee: number; minHours: number }>();

  for (const setting of settings) {
    if (!setting.code.startsWith(cityPricingPrefix)) {
      continue;
    }

    const [, encodedProvince, encodedCity, kind] = setting.code.split("::");
    const province = decodePricingKeyPart(encodedProvince);
    const city = decodePricingKeyPart(encodedCity);
    const key = `${province}::${city}`;
    const current = map.get(key) ?? { province, city, flatFee: 29, minHours: 2 };

    if (kind === "FLAT_FEE") {
      current.flatFee = setting.value;
    }

    if (kind === "MIN_HOURS") {
      current.minHours = setting.value;
    }

    map.set(key, current);
  }

  return Array.from(map.values()).sort((left, right) =>
    `${left.province} ${left.city}`.localeCompare(`${right.province} ${right.city}`)
  );
}

function parseFallbackPricing(settings: Array<{ code: string; value: number }>) {
  return {
    flatFee: settings.find((setting) => setting.code === fallbackFlatFeeCode)?.value ?? 35,
    minHours: settings.find((setting) => setting.code === fallbackMinHoursCode)?.value ?? 2
  };
}

function parseSettlementConfig(settings: Array<{ code: string; value: number }>) {
  const platformSharePercent = settings.find((setting) => setting.code === platformSharePercentCode)?.value ?? 30;
  const normalizedPlatformSharePercent = Math.max(0, Math.min(100, platformSharePercent));

  return {
    platformSharePercent: normalizedPlatformSharePercent,
    driverSharePercent: Math.max(0, 100 - normalizedPlatformSharePercent)
  };
}

function getSettlementWeekStart(dateInput: string | Date) {
  const date = new Date(dateInput);
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = normalized.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  normalized.setUTCDate(normalized.getUTCDate() - daysSinceMonday);
  return normalized;
}

function getSettlementWeekEnd(weekStart: Date) {
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return weekEnd;
}

adminRoutes.get(
  "/admin/dashboard",
  asyncHandler(async (_request, response) => {
    const [totalUsers, totalDrivers, pendingApplications, activeBookings, activeTrips, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.driver.count(),
      prisma.driverApplication.count({
        where: {
          status: {
            in: ["SUBMITTED", "UNDER_REVIEW"]
          }
        }
      }),
      prisma.booking.count({
        where: {
          status: {
            in: ["AWAITING_PAYMENT", "PENDING", "ACCEPTED", "ENROUTE", "ACTIVE"]
          }
        }
      }),
      prisma.booking.findMany({
        where: {
          status: "ACTIVE"
        },
        include: {
          customer: {
            include: {
              user: true
            }
          },
          assignedDriver: {
            include: {
              user: true
            }
          }
        }
      }),
      prisma.payment.aggregate({
        _sum: {
          amount: true
        },
        where: {
          status: "RECORDED"
        }
      })
    ]);

    response.json({
      metrics: {
        totalUsers,
        totalDrivers,
        pendingApplications,
        activeBookings,
        revenue: revenue._sum.amount ?? 0
      },
      activeTrips
    });
  })
);

adminRoutes.get(
  "/admin/applications",
  asyncHandler(async (_request, response) => {
    const applications = await prisma.driverApplication.findMany({
      include: {
        documents: true,
        user: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    response.json(applications);
  })
);

adminRoutes.post(
  "/admin/applications/:applicationId/review",
  asyncHandler(async (request, response) => {
    const applicationId = paramValue(request.params.applicationId);
    const schema = z.object({
      decision: z.enum(["approved", "rejected", "additional_info"]),
      note: z.string().min(2)
    });
    const input = schema.parse(request.body);

    const application = await prisma.driverApplication.findUnique({
      where: {
        id: applicationId
      },
      include: {
        user: true
      }
    });

    if (!application?.userId || !application.user) {
      throw new AppError("Driver application is missing its linked account", 400, "INVALID_APPLICATION");
    }

    const approved = input.decision === "approved";
    const additionalInfo = input.decision === "additional_info";

    if (approved && application.driverAbstractInitiatedAt && !application.criminalCheckInvitedAt) {
      throw new AppError("Confirm the driver abstract and send the criminal record verification before approving this application.", 400, "BACKGROUND_CHECK_INCOMPLETE");
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const sanitizedAvailabilitySchedule = buildDriverAvailabilitySummary(application.availabilitySchedule);
      const updatedApplication = await tx.driverApplication.update({
        where: { id: application.id },
        data: {
          status: approved ? "APPROVED" : additionalInfo ? "UNDER_REVIEW" : "REJECTED",
          reviewNote: input.note,
          reviewedByUserId: request.auth!.userId,
          reviewedAt: new Date()
        }
      });

      await tx.user.update({
        where: { id: application.userId! },
        data: {
          status: approved ? AccountStatus.ACTIVE : additionalInfo ? AccountStatus.PENDING_APPROVAL : AccountStatus.DISABLED
        }
      });

      if (approved) {
        await tx.driver.upsert({
          where: {
            userId: application.userId!
          },
          create: {
            userId: application.userId!,
            applicationId: application.id,
            licenseNumber: application.licenseNumber,
            yearsOfExperience: application.yearsOfExperience,
            emergencyContact: application.emergencyContact,
            serviceAreas: application.preferredServiceAreas,
            availabilitySchedule: sanitizedAvailabilitySchedule,
            approvedAt: new Date()
          },
          update: {
            applicationId: application.id,
            licenseNumber: application.licenseNumber,
            yearsOfExperience: application.yearsOfExperience,
            emergencyContact: application.emergencyContact,
            serviceAreas: application.preferredServiceAreas,
            availabilitySchedule: sanitizedAvailabilitySchedule,
            approvedAt: new Date()
          }
        });
      }

      await tx.notification.create({
        data: {
          userId: application.userId!,
          type: "APPLICATION_REVIEWED",
          title: approved ? "Application approved" : additionalInfo ? "Additional information requested" : "Application reviewed",
          body: approved ? `Your driver account is now active. ${input.note}`.trim() : input.note,
          channel: "EMAIL",
          status: "SENT",
          meta: {
            applicationId: application.id,
            decision: input.decision
          }
        }
      });

      return updatedApplication;
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: approved ? "DRIVER_APPLICATION_APPROVED" : additionalInfo ? "DRIVER_APPLICATION_INFO_REQUESTED" : "DRIVER_APPLICATION_REJECTED",
      entityType: "DriverApplication",
      entityId: application.id,
      details: { note: input.note }
    });

    try {
      const emailMessage = buildDriverApplicationStatusEmail({
        decision: input.decision,
        fullName: application.fullName,
        email: application.email,
        note: input.note
      });

      await sendTransactionalEmail({
        to: application.email,
        subject: emailMessage.subject,
        html: emailMessage.html,
        text: emailMessage.text
      });
    } catch (error) {
      console.error("Unable to send driver application review email", error);
    }

    response.json(result);
  })
);

adminRoutes.post(
  "/admin/applications/:applicationId/background-check",
  asyncHandler(async (request, response) => {
    const applicationId = paramValue(request.params.applicationId);
    const input = z.object({ comment: z.string().trim().min(2).max(2000) }).parse(request.body);

    const application = await prisma.driverApplication.findUnique({
      where: { id: applicationId },
      include: { user: true }
    });

    if (!application?.userId || !application.user) {
      throw new AppError("Driver application is missing its linked account", 400, "INVALID_APPLICATION");
    }

    if (application.status === "APPROVED" || application.status === "REJECTED") {
      throw new AppError("A finalised application cannot receive a background-check invitation.", 400, "APPLICATION_FINALISED");
    }

    if (application.criminalCheckInvitedAt) {
      throw new AppError("A criminal record verification link has already been sent for this application.", 409, "CRIMINAL_CHECK_ALREADY_INVITED");
    }

    const emailMessage = buildCriminalCheckInvitationEmail({
      fullName: application.fullName,
      note: input.comment
    });
    await sendTransactionalEmail({
      to: application.email,
      subject: emailMessage.subject,
      html: emailMessage.html,
      text: emailMessage.text
    });

    const invitedAt = new Date();
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedApplication = await tx.driverApplication.update({
        where: { id: application.id },
        data: {
          status: "UNDER_REVIEW",
          reviewNote: null,
          backgroundCheckComment: input.comment,
          criminalCheckInvitedAt: invitedAt,
          criminalCheckInvitedByUserId: request.auth!.userId,
          reviewedByUserId: request.auth!.userId,
          reviewedAt: invitedAt
        }
      });

      await tx.user.update({
        where: { id: application.userId },
        data: { status: AccountStatus.PENDING_APPROVAL }
      });

      await tx.notification.create({
        data: {
          userId: application.userId,
          type: "APPLICATION_REVIEWED",
          title: "Criminal record verification required",
          body: input.comment,
          channel: "EMAIL",
          status: "SENT",
          meta: { applicationId: application.id, stage: "CRIMINAL_RECORD_INVITATION" }
        }
      });

      return updatedApplication;
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "DRIVER_CRIMINAL_CHECK_INVITED",
      entityType: "DriverApplication",
      entityId: application.id,
      details: { comment: input.comment, invitedAt: invitedAt.toISOString() }
    });

    response.json(result);
  })
);

adminRoutes.get(
  "/admin/documents/:documentId/link",
  asyncHandler(async (request, response) => {
    const documentId = paramValue(request.params.documentId);
    const document = await prisma.document.findUnique({
      where: {
        id: documentId
      }
    });

    if (!document) {
      throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    }

    if (isS3DocumentReference(document.fileUrl)) {
      const signedUrl = await createDocumentAccessUrl(document.fileUrl).catch(() => {
        throw new AppError("Stored document file is unavailable", 404, "DOCUMENT_FILE_MISSING");
      });
      if (!signedUrl) {
        throw new AppError("Stored document file is unavailable", 404, "DOCUMENT_FILE_MISSING");
      }

      response.json({
        url: signedUrl,
        fileName: document.fileName,
        mimeType: document.mimeType ?? null
      });
      return;
    }

    response.json({
      url: `${request.protocol}://${request.get("host")}/api/admin/documents/${document.id}`,
      fileName: document.fileName,
      mimeType: document.mimeType ?? null
    });
  })
);

adminRoutes.get(
  "/admin/documents/:documentId",
  asyncHandler(async (request, response) => {
    const documentId = paramValue(request.params.documentId);
    const document = await prisma.document.findUnique({
      where: {
        id: documentId
      }
    });

    if (!document) {
      throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    }

    if (isS3DocumentReference(document.fileUrl)) {
      const signedUrl = await createDocumentAccessUrl(document.fileUrl).catch(() => {
        throw new AppError("Stored document file is unavailable", 404, "DOCUMENT_FILE_MISSING");
      });
      if (!signedUrl) {
        throw new AppError("Stored document file is unavailable", 404, "DOCUMENT_FILE_MISSING");
      }
      response.redirect(signedUrl);
      return;
    }

    if (!path.isAbsolute(document.fileUrl)) {
      response.redirect(document.fileUrl);
      return;
    }

    await access(document.fileUrl, fsConstants.R_OK).catch(() => {
      throw new AppError("Stored document file is unavailable", 404, "DOCUMENT_FILE_MISSING");
    });

    response.setHeader("Content-Type", document.mimeType ?? "application/octet-stream");
    response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.fileName)}"`);
    response.sendFile(document.fileUrl);
  })
);

adminRoutes.get(
  "/admin/drivers",
  asyncHandler(async (_request, response) => {
    const drivers = await prisma.driver.findMany({
      include: {
        user: true,
        bookings: {
          where: {
            status: {
              in: ["ACCEPTED", "ACTIVE"]
            }
          }
        }
      }
    });

    response.json(drivers);
  })
);

adminRoutes.get(
  "/admin/users",
  asyncHandler(async (_request, response) => {
    const users = await prisma.user.findMany({
      include: {
        customerProfile: {
          include: {
            vehicles: true,
            bookings: {
              orderBy: {
                scheduledStartAt: "desc"
              },
              take: 5
            }
          }
        },
        driver: {
          include: {
            application: true,
            bookings: {
              where: {
                status: {
                  in: ["ACCEPTED", "ACTIVE"]
                }
              }
            }
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    response.json(users);
  })
);

adminRoutes.post(
  "/admin/users",
  asyncHandler(async (request, response) => {
    const schema = z.object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().email(),
      phone: z
        .string()
        .trim()
        .max(40)
        .optional()
        .transform((value) => value || undefined),
      password: z.string().min(8).max(120),
      role: z.nativeEnum(UserRole),
      status: z.nativeEnum(AccountStatus).default(AccountStatus.ACTIVE)
    });
    const input = schema.parse(request.body);

    const existingUser = await prisma.user.findUnique({
      where: {
        email: input.email
      },
      select: {
        id: true
      }
    });

    if (existingUser) {
      throw new AppError("A user with this email already exists.", 409, "USER_EMAIL_TAKEN");
    }

    const createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone ?? null,
          passwordHash: await hashPassword(input.password),
          role: input.role,
          status: input.status,
          customerProfile:
            input.role === UserRole.CUSTOMER
              ? {
                  create: {
                    savedAddresses: []
                  }
                }
              : undefined,
          driver:
            input.role === UserRole.DRIVER
              ? {
                  create: {
                    licenseNumber: "PENDING",
                    yearsOfExperience: 0,
                    emergencyContact: "Pending",
                    serviceAreas: ["Canada"],
                    availabilityStatus: false,
                    availabilitySchedule: null
                  }
                }
              : undefined,
          adminUser:
            input.role === UserRole.ADMIN || input.role === UserRole.MARKETING
              ? {
                  create: {
                    permissions: []
                  }
                }
              : undefined
        }
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          customerProfile: {
            include: {
              vehicles: true,
              bookings: {
                orderBy: {
                  scheduledStartAt: "desc"
                },
                take: 5
              }
            }
          },
          driver: {
            include: {
              application: true,
              bookings: {
                where: {
                  status: {
                    in: ["ACCEPTED", "ACTIVE"]
                  }
                }
              }
            }
          }
        }
      });
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "ADMIN_USER_CREATED",
      entityType: "User",
      entityId: createdUser.id,
      details: {
        email: createdUser.email,
        role: createdUser.role,
        status: createdUser.status
      }
    });

    response.status(201).json(createdUser);
  })
);

adminRoutes.patch(
  "/admin/users/:userId",
  asyncHandler(async (request, response) => {
    const userId = paramValue(request.params.userId);
    const schema = z.object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().email(),
      phone: z
        .string()
        .trim()
        .max(40)
        .optional()
        .transform((value) => value || undefined),
      role: z.nativeEnum(UserRole),
      status: z.nativeEnum(AccountStatus),
      membershipTier: z.nativeEnum(MembershipTier).optional(),
      membershipStatus: z.nativeEnum(MembershipStatus).optional(),
      membershipBillingCycle: z.nativeEnum(MembershipBillingCycle).optional(),
      membershipHourlyRate: z.number().min(0).max(500).nullable().optional(),
      savedAddresses: z.array(z.string().trim().min(3).max(240)).optional(),
      driver: z
        .object({
          licenseNumber: z.string().trim().min(2).max(80),
          yearsOfExperience: z.number().int().min(0).max(60),
          emergencyContact: z.string().trim().min(2).max(120),
          serviceAreas: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
          availabilitySchedule: z
            .string()
            .trim()
            .max(240)
            .optional()
            .transform((value) => value || null),
          availabilityStatus: z.boolean()
        })
        .optional()
    });
    const input = schema.parse(request.body);

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerProfile: true,
        driver: true,
        adminUser: true
      }
    });

    if (!existingUser) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone ?? null,
          role: input.role,
          status: input.status,
          membershipTier: input.membershipTier ?? existingUser.membershipTier,
          membershipStatus: input.membershipStatus ?? existingUser.membershipStatus,
          membershipBillingCycle: input.membershipBillingCycle ?? existingUser.membershipBillingCycle,
          membershipHourlyRate:
            input.membershipHourlyRate === undefined ? existingUser.membershipHourlyRate : input.membershipHourlyRate
        }
      });

      if (input.role === UserRole.CUSTOMER && !existingUser.customerProfile) {
        await tx.customerProfile.create({
          data: {
            userId,
            savedAddresses: input.savedAddresses ?? []
          }
        });
      }

      if (existingUser.customerProfile && input.savedAddresses) {
        await tx.customerProfile.update({
          where: {
            userId
          },
          data: {
            savedAddresses: input.savedAddresses
          }
        });
      }

      if ((input.role === UserRole.ADMIN || input.role === UserRole.MARKETING) && !existingUser.adminUser) {
        await tx.adminUser.create({
          data: {
            userId,
            permissions: []
          }
        });
      }

      if (input.role === UserRole.DRIVER && !existingUser.driver) {
        await tx.driver.create({
          data: {
            userId,
            licenseNumber: input.driver?.licenseNumber ?? "PENDING",
            yearsOfExperience: input.driver?.yearsOfExperience ?? 0,
            emergencyContact: input.driver?.emergencyContact ?? "Pending",
            serviceAreas: input.driver?.serviceAreas?.length ? input.driver.serviceAreas : ["Canada"],
            availabilitySchedule: input.driver?.availabilitySchedule ?? null,
            availabilityStatus: input.driver?.availabilityStatus ?? false
          }
        });
      }

      if (existingUser.driver && input.driver) {
        await tx.driver.update({
          where: {
            userId
          },
          data: {
            licenseNumber: input.driver.licenseNumber,
            yearsOfExperience: input.driver.yearsOfExperience,
            emergencyContact: input.driver.emergencyContact,
            serviceAreas: input.driver.serviceAreas,
            availabilitySchedule: input.driver.availabilitySchedule,
            availabilityStatus: input.driver.availabilityStatus
          }
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          customerProfile: {
            include: {
              vehicles: true,
              bookings: {
                orderBy: {
                  scheduledStartAt: "desc"
                },
                take: 5
              }
            }
          },
          driver: {
            include: {
              application: true,
              bookings: {
                where: {
                  status: {
                    in: ["ACCEPTED", "ACTIVE"]
                  }
                }
              }
            }
          }
        }
      });
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "ADMIN_USER_UPDATED",
      entityType: "User",
      entityId: userId,
      details: {
        email: updatedUser.email,
        role: updatedUser.role,
        status: updatedUser.status
      }
    });

    response.json(updatedUser);
  })
);

adminRoutes.delete(
  "/admin/users/:userId",
  asyncHandler(async (request, response) => {
    const userId = paramValue(request.params.userId);

    if (request.auth!.userId === userId) {
      throw new AppError("You cannot delete your own admin account.", 400, "SELF_DELETE_BLOCKED");
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true
      }
    });

    if (!existingUser) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    await prisma.user.delete({
      where: {
        id: userId
      }
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "ADMIN_USER_DELETED",
      entityType: "User",
      entityId: existingUser.id,
      details: {
        email: existingUser.email,
        role: existingUser.role
      }
    });

    response.status(204).send();
  })
);

adminRoutes.post(
  "/admin/users/:userId/password",
  asyncHandler(async (request, response) => {
    const userId = paramValue(request.params.userId);
    const schema = z.object({
      newPassword: z.string().min(8).max(120)
    });
    const { newPassword } = schema.parse(request.body);

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true
      }
    });

    if (!existingUser) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    if (existingUser.role !== UserRole.ADMIN && existingUser.role !== UserRole.MARKETING) {
      throw new AppError(
        "Password resets from admin are limited to admin and marketing users.",
        400,
        "PASSWORD_RESET_ROLE_NOT_ALLOWED"
      );
    }

    await prisma.user.update({
      where: {
        id: userId
      },
      data: {
        passwordHash: await hashPassword(newPassword)
      }
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "ADMIN_USER_PASSWORD_RESET",
      entityType: "User",
      entityId: existingUser.id,
      details: {
        email: existingUser.email,
        role: existingUser.role
      }
    });

    response.json({
      success: true
    });
  })
);

adminRoutes.post(
  "/admin/users/:userId/status",
  asyncHandler(async (request, response) => {
    const userId = paramValue(request.params.userId);
    const schema = z.object({
      status: z.enum(["ACTIVE", "DISABLED", "PENDING_APPROVAL"])
    });
    const { status } = schema.parse(request.body);

    const user = await prisma.user.update({
      where: {
        id: userId
      },
      data: { status }
    });

    response.json(user);
  })
);

adminRoutes.get(
  "/admin/bookings",
  asyncHandler(async (_request, response) => {
    const bookings = await prisma.booking.findMany({
      include: {
        customer: {
          include: {
            user: true
          }
        },
        assignedDriver: {
          include: {
            user: true
          }
        },
        dispatches: {
          include: {
            driver: {
              include: {
                user: true
              }
            }
          },
          orderBy: {
            distanceKm: "asc"
          }
        },
        trip: true,
        payment: true
      },
      orderBy: {
        scheduledStartAt: "desc"
      }
    });

    response.json(bookings);
  })
);

adminRoutes.post(
  "/admin/bookings/:bookingId/status",
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      status: z.nativeEnum(BookingStatus)
    });
    const { status } = schema.parse(request.body);

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        trip: true,
        payment: true
      }
    });

    if (!booking) {
      throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
    }

    const now = new Date();
    const operationalStatuses: BookingStatus[] = [
      BookingStatus.ACCEPTED,
      BookingStatus.ENROUTE,
      BookingStatus.ACTIVE,
      BookingStatus.COMPLETED
    ];
    const requiresAssignedDriver = operationalStatuses.includes(status);
    const isCancelled = status === BookingStatus.CANCELLED;
    const isCompleted = status === BookingStatus.COMPLETED;
    const isOperational = status === BookingStatus.ACTIVE || status === BookingStatus.ENROUTE;
    const isScheduledTrip =
      status === BookingStatus.AWAITING_PAYMENT || status === BookingStatus.PENDING || status === BookingStatus.ACCEPTED;
    const nextTripStatus = isCancelled
      ? TripStatus.CANCELLED
      : isCompleted
        ? TripStatus.COMPLETED
        : isOperational
          ? TripStatus.ACTIVE
          : TripStatus.SCHEDULED;

    if (requiresAssignedDriver && !booking.assignedDriverId) {
      throw new AppError("Assign a driver before moving this booking into an operational trip state", 409, "DRIVER_REQUIRED");
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status,
        acceptedAt: status === BookingStatus.ACCEPTED && !booking.acceptedAt ? now : booking.acceptedAt,
        cancelledAt: isCancelled ? now : null,
        completedAt: isCompleted ? now : null,
        trip: booking.assignedDriverId
          ? {
              upsert: {
                create: {
                  driverId: booking.assignedDriverId,
                  status: nextTripStatus,
                  startedAt: isOperational ? booking.trip?.startedAt ?? now : null,
                  endedAt: isCompleted || isCancelled ? now : null,
                  navigationEnabled: isOperational,
                  liveTrackingEnabled: isOperational
                },
                update: {
                  driverId: booking.assignedDriverId,
                  status: nextTripStatus,
                  startedAt: isOperational ? booking.trip?.startedAt ?? now : isScheduledTrip ? null : booking.trip?.startedAt ?? null,
                  endedAt: isCompleted || isCancelled ? now : null,
                  navigationEnabled: isOperational,
                  liveTrackingEnabled: isOperational
                }
              }
            }
          : undefined,
        payment:
          status === BookingStatus.COMPLETED
            ? {
                upsert: {
                  create: {
                    amount: booking.fareEstimate,
                    currency: "CAD",
                    status: PaymentStatus.PENDING,
                    notes: "Recorded as pending settlement placeholder from admin lifecycle update."
                  },
                  update: {
                    amount: booking.fareEstimate,
                    currency: "CAD",
                    status: booking.payment?.status ?? PaymentStatus.PENDING
                  }
                }
              }
            : undefined
      },
      include: {
        customer: {
          include: {
            user: true
          }
        },
        assignedDriver: {
          include: {
            user: true
          }
        },
        trip: true,
        payment: true
      }
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "BOOKING_STATUS_UPDATED",
      entityType: "Booking",
      entityId: booking.id,
      details: { status }
    });

    response.json(updatedBooking);
  })
);

adminRoutes.get(
  "/admin/reports",
  asyncHandler(async (_request, response) => {
    const [approvedDrivers, pendingApplications, activeCustomers, payments, completedTrips, scheduledTrips, ratings] = await Promise.all([
      prisma.driver.findMany({
        include: {
          user: true
        },
        orderBy: {
          approvedAt: "desc"
        }
      }),
      prisma.driverApplication.findMany({
        where: {
          status: {
            in: ["SUBMITTED", "UNDER_REVIEW"]
          }
        },
        include: {
          user: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      prisma.customerProfile.findMany({
        include: {
          user: true,
          bookings: {
            orderBy: {
              createdAt: "desc"
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      prisma.payment.findMany({
        include: {
          booking: {
            include: {
              customer: {
                include: {
                  user: true
                }
              },
              assignedDriver: {
                include: {
                  user: true
                }
              }
            }
          }
        },
        orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }]
      }),
      prisma.booking.findMany({
        where: { status: "COMPLETED" },
        include: {
          customer: {
            include: {
              user: true
            }
          },
          assignedDriver: {
            include: {
              user: true
            }
          },
          payment: true
        },
        orderBy: {
          completedAt: "desc"
        }
      }),
      prisma.booking.findMany({
        where: {
          status: {
            in: ["AWAITING_PAYMENT", "PENDING", "ACCEPTED", "ENROUTE", "ACTIVE"]
          }
        },
        include: {
          customer: {
            include: {
              user: true
            }
          },
          assignedDriver: {
            include: {
              user: true
            }
          },
          payment: true
        },
        orderBy: {
          scheduledStartAt: "desc"
        }
      }),
      prisma.rating.findMany({
        include: {
          booking: true,
          reviewer: true,
          reviewed: true
        },
        orderBy: { createdAt: "desc" }
      })
    ]);

    response.json({
      approvedDrivers,
      pendingApplications,
      activeCustomers,
      completedTrips,
      scheduledTrips,
      payments,
      ratings
    });
  })
);

adminRoutes.get(
  "/admin/settlements",
  asyncHandler(async (_request, response) => {
    const [pricing, completedBookings, payoutRecords] = await Promise.all([
      prisma.pricingSetting.findMany(),
      prisma.booking.findMany({
        where: {
          status: BookingStatus.COMPLETED,
          assignedDriverId: {
            not: null
          },
          payment: {
            is: {
              status: PaymentStatus.RECORDED
            }
          }
        },
        include: {
          assignedDriver: {
            include: {
              user: true
            }
          },
          customer: {
            include: {
              user: true
            }
          },
          payment: true
        },
        orderBy: {
          completedAt: "desc"
        }
      }),
      prisma.driverSettlement.findMany({
        include: {
          driver: {
            include: {
              user: true
            }
          }
        },
        orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }]
      })
    ]);

    const settlementConfig = parseSettlementConfig(pricing);
    const grouped = new Map<
      string,
      {
        id: string;
        weekStart: string;
        weekEnd: string;
        driverId: string;
        driverName: string;
        driverEmail: string;
        tripCount: number;
        grossAmount: number;
        platformSharePercent: number;
        platformShareAmount: number;
        driverShareAmount: number;
        status: "PENDING" | "PAID";
        paidAt: string | null;
        payoutReference: string | null;
        notes: string | null;
        latestCompletedAt: string | null;
        trips: Array<{
          bookingId: string;
          completedAt: string | null;
          amount: number;
          customerName: string;
          pickupLocation: string;
          destinationLocation: string;
        }>;
      }
    >();

    for (const booking of completedBookings) {
      if (!booking.assignedDriver || !booking.payment) {
        continue;
      }

      const settlementDate = booking.completedAt ?? booking.payment.recordedAt ?? booking.updatedAt;
      const weekStart = getSettlementWeekStart(settlementDate);
      const weekEnd = getSettlementWeekEnd(weekStart);
      const weekStartKey = weekStart.toISOString().slice(0, 10);
      const weekEndKey = weekEnd.toISOString().slice(0, 10);
      const groupKey = `${booking.assignedDriverId}::${weekStartKey}`;
      const grossAmount = Number(booking.payment.amount ?? booking.fareEstimate ?? 0);
      const platformShareAmount = Number(
        ((grossAmount * settlementConfig.platformSharePercent) / 100).toFixed(2)
      );
      const driverShareAmount = Number((grossAmount - platformShareAmount).toFixed(2));

      const current: {
        id: string;
        weekStart: string;
        weekEnd: string;
        driverId: string;
        driverName: string;
        driverEmail: string;
        tripCount: number;
        grossAmount: number;
        platformSharePercent: number;
        platformShareAmount: number;
        driverShareAmount: number;
        status: "PENDING" | "PAID";
        paidAt: string | null;
        payoutReference: string | null;
        notes: string | null;
        latestCompletedAt: string | null;
        trips: Array<{
          bookingId: string;
          completedAt: string | null;
          amount: number;
          customerName: string;
          pickupLocation: string;
          destinationLocation: string;
        }>;
      } = grouped.get(groupKey) ?? {
        id: groupKey,
        weekStart: weekStartKey,
        weekEnd: weekEndKey,
        driverId: booking.assignedDriver.id,
        driverName: booking.assignedDriver.user?.fullName ?? "Assigned driver",
        driverEmail: booking.assignedDriver.user?.email ?? "",
        tripCount: 0,
        grossAmount: 0,
        platformSharePercent: settlementConfig.platformSharePercent,
        platformShareAmount: 0,
        driverShareAmount: 0,
        status: "PENDING",
        paidAt: null,
        payoutReference: null,
        notes: null,
        latestCompletedAt: null,
        trips: []
      };

      current.tripCount += 1;
      current.grossAmount = Number((current.grossAmount + grossAmount).toFixed(2));
      current.platformShareAmount = Number((current.platformShareAmount + platformShareAmount).toFixed(2));
      current.driverShareAmount = Number((current.driverShareAmount + driverShareAmount).toFixed(2));
      current.latestCompletedAt =
        !current.latestCompletedAt || new Date(settlementDate) > new Date(current.latestCompletedAt)
          ? settlementDate.toISOString()
          : current.latestCompletedAt;
      current.trips.push({
        bookingId: booking.id,
        completedAt: booking.completedAt?.toISOString() ?? null,
        amount: grossAmount,
        customerName: booking.customer?.user?.fullName ?? "Customer",
        pickupLocation: booking.pickupLocation,
        destinationLocation: booking.destinationLocation
      });

      grouped.set(groupKey, current);
    }

    for (const record of payoutRecords) {
      const weekStartKey = record.weekStart.toISOString().slice(0, 10);
      const weekEndKey = record.weekEnd.toISOString().slice(0, 10);
      const groupKey = `${record.driverId}::${weekStartKey}`;
      const current = grouped.get(groupKey);

      if (current) {
        current.platformSharePercent = record.platformSharePercent;
        current.grossAmount = record.grossAmount;
        current.platformShareAmount = record.platformShareAmount;
        current.driverShareAmount = record.driverShareAmount;
        current.tripCount = record.tripCount;
        current.status = record.status;
        current.paidAt = record.paidAt?.toISOString() ?? null;
        current.payoutReference = record.payoutReference ?? null;
        current.notes = record.notes ?? null;
        grouped.set(groupKey, current);
        continue;
      }

      grouped.set(groupKey, {
        id: groupKey,
        weekStart: weekStartKey,
        weekEnd: weekEndKey,
        driverId: record.driverId,
        driverName: record.driver.user?.fullName ?? "Assigned driver",
        driverEmail: record.driver.user?.email ?? "",
        tripCount: record.tripCount,
        grossAmount: record.grossAmount,
        platformSharePercent: record.platformSharePercent,
        platformShareAmount: record.platformShareAmount,
        driverShareAmount: record.driverShareAmount,
        status: record.status,
        paidAt: record.paidAt?.toISOString() ?? null,
        payoutReference: record.payoutReference ?? null,
        notes: record.notes ?? null,
        latestCompletedAt: null,
        trips: []
      });
    }

    const settlements = Array.from(grouped.values()).sort((left, right) => {
      if (left.weekStart === right.weekStart) {
        return left.driverName.localeCompare(right.driverName);
      }

      return right.weekStart.localeCompare(left.weekStart);
    });

    const summary = settlements.reduce(
      (totals, settlement) => {
        totals.grossAmount = Number((totals.grossAmount + settlement.grossAmount).toFixed(2));
        totals.platformShareAmount = Number((totals.platformShareAmount + settlement.platformShareAmount).toFixed(2));
        totals.driverShareAmount = Number((totals.driverShareAmount + settlement.driverShareAmount).toFixed(2));
        totals.tripCount += settlement.tripCount;
        totals.pendingRows += settlement.status === "PAID" ? 0 : 1;
        totals.paidRows += settlement.status === "PAID" ? 1 : 0;
        totals.pendingDriverShareAmount = Number(
          (totals.pendingDriverShareAmount + (settlement.status === "PAID" ? 0 : settlement.driverShareAmount)).toFixed(2)
        );
        totals.paidDriverShareAmount = Number(
          (totals.paidDriverShareAmount + (settlement.status === "PAID" ? settlement.driverShareAmount : 0)).toFixed(2)
        );
        return totals;
      },
      {
        grossAmount: 0,
        platformShareAmount: 0,
        driverShareAmount: 0,
        tripCount: 0,
        pendingRows: 0,
        paidRows: 0,
        pendingDriverShareAmount: 0,
        paidDriverShareAmount: 0
      }
    );

    response.json({
      settlementConfig,
      summary: {
        ...summary,
        weeklyRows: settlements.length
      },
      settlements
    });
  })
);

adminRoutes.post(
  "/admin/settlements/:driverId/:weekStart/status",
  asyncHandler(async (request, response) => {
    const schema = z.object({
      status: z.enum(["PENDING", "PAID"]),
      payoutReference: z.string().trim().max(120).optional().nullable(),
      notes: z.string().trim().max(500).optional().nullable()
    });

    const input = schema.parse(request.body);
    const driverId = paramValue(request.params.driverId);
    const weekStartParam = paramValue(request.params.weekStart);
    const weekStart = new Date(`${weekStartParam}T00:00:00.000Z`);

    if (Number.isNaN(weekStart.getTime())) {
      throw new AppError("A valid settlement week is required.", 400, "INVALID_SETTLEMENT_PERIOD");
    }

    const weekEnd = getSettlementWeekEnd(weekStart);
    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);

    const [driver, pricing, bookings] = await Promise.all([
      prisma.driver.findUnique({
        where: { id: driverId },
        include: {
          user: true
        }
      }),
      prisma.pricingSetting.findMany(),
      prisma.booking.findMany({
        where: {
          assignedDriverId: driverId,
          status: BookingStatus.COMPLETED,
          payment: {
            is: {
              status: PaymentStatus.RECORDED
            }
          },
          OR: [
            {
              completedAt: {
                gte: weekStart,
                lt: nextWeekStart
              }
            },
            {
              completedAt: null,
              payment: {
                is: {
                  recordedAt: {
                    gte: weekStart,
                    lt: nextWeekStart
                  }
                }
              }
            }
          ]
        },
        include: {
          payment: true
        }
      })
    ]);

    if (!driver) {
      throw new AppError("Driver account not found.", 404, "DRIVER_NOT_FOUND");
    }

    if (!bookings.length) {
      throw new AppError("No completed paid trips were found for that payout week.", 404, "SETTLEMENT_NOT_FOUND");
    }

    const settlementConfig = parseSettlementConfig(pricing);
    const grossAmount = Number(
      bookings.reduce((sum, booking) => sum + Number(booking.payment?.amount ?? booking.fareEstimate ?? 0), 0).toFixed(2)
    );
    const platformShareAmount = Number(
      ((grossAmount * settlementConfig.platformSharePercent) / 100).toFixed(2)
    );
    const driverShareAmount = Number((grossAmount - platformShareAmount).toFixed(2));

    const settlement = await prisma.driverSettlement.upsert({
      where: {
        driverId_weekStart: {
          driverId,
          weekStart
        }
      },
      create: {
        driverId,
        weekStart,
        weekEnd,
        status: input.status,
        grossAmount,
        platformSharePercent: settlementConfig.platformSharePercent,
        platformShareAmount,
        driverShareAmount,
        tripCount: bookings.length,
        paidAt: input.status === "PAID" ? new Date() : null,
        payoutReference: input.payoutReference || null,
        notes: input.notes || null
      },
      update: {
        weekEnd,
        status: input.status,
        grossAmount,
        platformSharePercent: settlementConfig.platformSharePercent,
        platformShareAmount,
        driverShareAmount,
        tripCount: bookings.length,
        paidAt: input.status === "PAID" ? new Date() : null,
        payoutReference: input.payoutReference || null,
        notes: input.notes || null
      }
    });

    await createAuditLog({
      actorId: request.auth?.userId,
      action: input.status === "PAID" ? "admin.settlement.mark_paid" : "admin.settlement.reopen",
      entityType: "DriverSettlement",
      entityId: settlement.id,
      details: {
        driverId,
        driverEmail: driver.user?.email ?? null,
        weekStart: weekStart.toISOString(),
        grossAmount,
        driverShareAmount,
        platformShareAmount,
        payoutReference: input.payoutReference || null
      }
    });

    response.json({
      settlement: {
        id: settlement.id,
        driverId,
        driverName: driver.user?.fullName ?? "Assigned driver",
        status: settlement.status,
        weekStart: settlement.weekStart.toISOString(),
        weekEnd: settlement.weekEnd.toISOString(),
        tripCount: settlement.tripCount,
        grossAmount: settlement.grossAmount,
        platformShareAmount: settlement.platformShareAmount,
        driverShareAmount: settlement.driverShareAmount,
        paidAt: settlement.paidAt?.toISOString() ?? null,
        payoutReference: settlement.payoutReference,
        notes: settlement.notes
      }
    });
  })
);

adminRoutes.get(
  "/admin/settings",
  asyncHandler(async (_request, response) => {
    disableResponseCache(response);

    const [zones, pricing] = await Promise.all([
      prisma.serviceZone.findMany({
        where: { isActive: true }
      }),
      prisma.pricingSetting.findMany()
    ]);

    response.json({
      zones,
      pricing,
      provincePricing: parseProvincePricing(pricing),
      cityPricing: parseCityPricing(pricing),
      fallbackPricing: parseFallbackPricing(pricing),
      settlementConfig: parseSettlementConfig(pricing)
    });
  })
);

adminRoutes.post(
  "/admin/settings/pricing",
  asyncHandler(async (request, response) => {
    const schema = z.object({
      provincePricing: z
        .array(
          z.object({
            province: z.string().min(2),
            flatFee: z.coerce.number().min(0),
            minHours: z.coerce.number().min(1)
          })
        )
        .optional(),
      cityPricing: z
        .array(
          z.object({
            province: z.string().min(2),
            city: z.string().min(2),
            flatFee: z.coerce.number().min(0),
            minHours: z.coerce.number().min(1)
          })
        )
        .optional(),
      fallbackPricing: z
        .object({
          flatFee: z.coerce.number().min(0),
          minHours: z.coerce.number().min(1)
        })
        .optional(),
      settlementConfig: z
        .object({
          platformSharePercent: z.coerce.number().min(0).max(100)
        })
        .optional()
    }).refine(
      (value) =>
        value.provincePricing !== undefined ||
        value.cityPricing !== undefined ||
        value.fallbackPricing !== undefined ||
        value.settlementConfig !== undefined,
      { message: "At least one pricing setting must be provided." }
    );

    const input = schema.parse(request.body);

    await prisma.$transaction(async (tx) => {
      const deleteFilters: Prisma.PricingSettingWhereInput[] = [];

      if (input.provincePricing !== undefined) {
        deleteFilters.push({ code: { startsWith: provincePricingPrefix } });
      }

      if (input.cityPricing !== undefined) {
        deleteFilters.push({ code: { startsWith: cityPricingPrefix } });
      }

      if (input.settlementConfig !== undefined) {
        deleteFilters.push({ code: { startsWith: settlementConfigPrefix } });
      }

      if (deleteFilters.length) {
        await tx.pricingSetting.deleteMany({
          where: {
            OR: deleteFilters
          }
        });
      }

      const provinceRows =
        input.provincePricing?.flatMap((item) => [
          {
            code: buildProvincePricingCode(item.province, "FLAT_FEE"),
            name: `${item.province} flat fee`,
            value: item.flatFee,
            description: `Flat hourly fee for ${item.province}`
          },
          {
            code: buildProvincePricingCode(item.province, "MIN_HOURS"),
            name: `${item.province} minimum booking hours`,
            value: item.minHours,
            description: `Minimum booking hours for ${item.province}`
          }
        ]) ?? [];

      const cityRows =
        input.cityPricing?.flatMap((item) => [
          {
            code: buildCityPricingCode(item.province, item.city, "FLAT_FEE"),
            name: `${item.city}, ${item.province} flat fee`,
            value: item.flatFee,
            description: `City override flat fee for ${item.city}, ${item.province}`
          },
          {
            code: buildCityPricingCode(item.province, item.city, "MIN_HOURS"),
            name: `${item.city}, ${item.province} minimum booking hours`,
            value: item.minHours,
            description: `City override minimum booking hours for ${item.city}, ${item.province}`
          }
        ]) ?? [];

      const settlementRows = input.settlementConfig
        ? [
            {
              code: platformSharePercentCode,
              name: "Platform share percent",
              value: input.settlementConfig.platformSharePercent,
              description: "Platform revenue share percentage applied to completed paid trips."
            }
          ]
        : [];

      const rows = [...provinceRows, ...cityRows, ...settlementRows];

      if (rows.length) {
        await tx.pricingSetting.createMany({
          data: rows
        });
      }

      if (input.fallbackPricing !== undefined) {
        await tx.pricingSetting.upsert({
          where: { code: fallbackFlatFeeCode },
          create: {
            code: fallbackFlatFeeCode,
            name: "Fallback flat fee",
            value: input.fallbackPricing.flatFee,
            description: "Flat hourly fee when pickup pricing is outside configured Canada regions."
          },
          update: {
            value: input.fallbackPricing.flatFee
          }
        });

        await tx.pricingSetting.upsert({
          where: { code: fallbackMinHoursCode },
          create: {
            code: fallbackMinHoursCode,
            name: "Fallback minimum booking hours",
            value: input.fallbackPricing.minHours,
            description: "Minimum booking hours when pickup pricing is outside configured Canada regions."
          },
          update: {
            value: input.fallbackPricing.minHours
          }
        });
      }
    });

    const [zones, pricing] = await Promise.all([
      prisma.serviceZone.findMany({
        where: { isActive: true }
      }),
      prisma.pricingSetting.findMany()
    ]);

    disableResponseCache(response);

    response.json({
      zones,
      pricing,
      provincePricing: parseProvincePricing(pricing),
      cityPricing: parseCityPricing(pricing),
      fallbackPricing: parseFallbackPricing(pricing),
      settlementConfig: parseSettlementConfig(pricing)
    });
  })
);
