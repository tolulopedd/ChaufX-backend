import { AccountStatus, BookingStatus, PaymentStatus, TripStatus, type Prisma } from "@prisma/client";
import { Router } from "express";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createAuditLog } from "../../lib/audit.js";
import { AppError } from "../../common/AppError.js";

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
            in: ["PENDING", "ACCEPTED", "ENROUTE", "ACTIVE"]
          }
        }
      }),
      prisma.booking.findMany({
        where: {
          status: "ACTIVE"
        },
        include: {
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

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
            availabilitySchedule: application.availabilitySchedule,
            approvedAt: new Date()
          },
          update: {
            applicationId: application.id,
            licenseNumber: application.licenseNumber,
            yearsOfExperience: application.yearsOfExperience,
            emergencyContact: application.emergencyContact,
            serviceAreas: application.preferredServiceAreas,
            availabilitySchedule: application.availabilitySchedule,
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

    response.json(result);
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
    const isScheduledTrip = status === BookingStatus.PENDING || status === BookingStatus.ACCEPTED;
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
            in: ["PENDING", "ACCEPTED", "ENROUTE", "ACTIVE"]
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
  "/admin/settings",
  asyncHandler(async (_request, response) => {
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
      cityPricing: parseCityPricing(pricing)
    });
  })
);

adminRoutes.post(
  "/admin/settings/pricing",
  asyncHandler(async (request, response) => {
    const schema = z.object({
      provincePricing: z.array(
        z.object({
          province: z.string().min(2),
          flatFee: z.coerce.number().min(0),
          minHours: z.coerce.number().min(1)
        })
      ),
      cityPricing: z.array(
        z.object({
          province: z.string().min(2),
          city: z.string().min(2),
          flatFee: z.coerce.number().min(0),
          minHours: z.coerce.number().min(1)
        })
      )
    });

    const input = schema.parse(request.body);

    await prisma.$transaction(async (tx) => {
      await tx.pricingSetting.deleteMany({
        where: {
          OR: [{ code: { startsWith: provincePricingPrefix } }, { code: { startsWith: cityPricingPrefix } }]
        }
      });

      const provinceRows = input.provincePricing.flatMap((item) => [
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
      ]);

      const cityRows = input.cityPricing.flatMap((item) => [
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
      ]);

      const rows = [...provinceRows, ...cityRows];

      if (rows.length) {
        await tx.pricingSetting.createMany({
          data: rows
        });
      }
    });

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
      cityPricing: parseCityPricing(pricing)
    });
  })
);
