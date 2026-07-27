import { type Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const driversRoutes = Router();

driversRoutes.use(requireAuth);

const settlementConfigPrefix = "SETTLEMENT::";
const platformSharePercentCode = `${settlementConfigPrefix}PLATFORM_SHARE_PERCENT`;
type SettlementStatus = "PENDING" | "PAID";

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

driversRoutes.get(
  "/drivers/me",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const [driver, ratingAggregate, pricingSettings, payoutRecords] = await Promise.all([
      prisma.driver.findUniqueOrThrow({
        where: { userId: request.auth!.userId },
        include: {
          application: true,
          user: true,
          bookings: {
            include: {
              customer: {
                include: {
                  user: true
                }
              },
              payment: true,
              trip: true
            },
            orderBy: {
              scheduledStartAt: "desc"
            },
            take: 100
          }
        }
      }),
      prisma.rating.aggregate({
        where: {
          reviewedUserId: request.auth!.userId
        },
        _avg: {
          score: true
        },
        _count: {
          _all: true
        }
      }),
      prisma.pricingSetting.findMany({
        where: {
          code: {
            startsWith: settlementConfigPrefix
          }
        }
      }),
      prisma.driverSettlement.findMany({
        where: {
          driver: {
            userId: request.auth!.userId
          }
        },
        orderBy: {
          weekStart: "desc"
        }
      })
    ]);

    const platformSharePercent = Math.max(
      0,
      Math.min(100, pricingSettings.find((setting: { code: string; value: number }) => setting.code === platformSharePercentCode)?.value ?? 30)
    );
    const driverSharePercent = Math.max(0, 100 - platformSharePercent);

    const paidCompletedBookings = driver.bookings.filter(
      (booking: Prisma.DriverGetPayload<{
        include: {
          application: true;
          user: true;
          bookings: {
            include: {
              customer: {
                include: {
                  user: true;
                };
              };
              payment: true;
              trip: true;
            };
          };
        };
      }>["bookings"][number]) => booking.status === "COMPLETED" && booking.payment?.status === "RECORDED"
    );

    const currentWeekStart = getSettlementWeekStart(new Date());
    const currentWeekStartTime = currentWeekStart.getTime();

    const settlementRows = new Map<
      string,
      {
        id: string;
        weekStart: string;
        weekEnd: string;
        tripCount: number;
        grossAmount: number;
        platformSharePercent: number;
        platformShareAmount: number;
        driverShareAmount: number;
        status: SettlementStatus;
        paidAt: string | null;
        payoutReference: string | null;
        notes: string | null;
        latestCompletedAt: string;
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

    for (const booking of paidCompletedBookings) {
      const grossAmount = Number(booking.payment?.amount ?? booking.fareEstimate ?? 0);
      const platformShareAmount = Number(((grossAmount * platformSharePercent) / 100).toFixed(2));
      const driverShareAmount = Number(((grossAmount * driverSharePercent) / 100).toFixed(2));
      const settlementDate = booking.completedAt ?? booking.payment?.recordedAt ?? booking.updatedAt;
      const weekStart = getSettlementWeekStart(settlementDate);
      const weekEnd = getSettlementWeekEnd(weekStart);
      const key = weekStart.toISOString();
      const current: {
        id: string;
        weekStart: string;
        weekEnd: string;
        tripCount: number;
        grossAmount: number;
        platformSharePercent: number;
        platformShareAmount: number;
        driverShareAmount: number;
        status: SettlementStatus;
        paidAt: string | null;
        payoutReference: string | null;
        notes: string | null;
        latestCompletedAt: string;
        trips: Array<{
          bookingId: string;
          completedAt: string | null;
          amount: number;
          customerName: string;
          pickupLocation: string;
          destinationLocation: string;
        }>;
      } = settlementRows.get(key) ?? {
        id: key,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        tripCount: 0,
        grossAmount: 0,
        platformSharePercent,
        platformShareAmount: 0,
        driverShareAmount: 0,
        status: "PENDING",
        paidAt: null,
        payoutReference: null,
        notes: null,
        latestCompletedAt: new Date(settlementDate).toISOString(),
        trips: []
      };

      current.tripCount += 1;
      current.grossAmount = Number((current.grossAmount + grossAmount).toFixed(2));
      current.platformShareAmount = Number((current.platformShareAmount + platformShareAmount).toFixed(2));
      current.driverShareAmount = Number((current.driverShareAmount + driverShareAmount).toFixed(2));

      if (new Date(settlementDate).toISOString() > current.latestCompletedAt) {
        current.latestCompletedAt = new Date(settlementDate).toISOString();
      }

      current.trips.push({
        bookingId: booking.id,
        completedAt: booking.completedAt?.toISOString() ?? null,
        amount: grossAmount,
        customerName: booking.customer?.user?.fullName ?? "Customer",
        pickupLocation: booking.pickupLocation,
        destinationLocation: booking.destinationLocation
      });

      settlementRows.set(key, current);
    }

    for (const payoutRecord of payoutRecords) {
      const key = payoutRecord.weekStart.toISOString();
      const current = settlementRows.get(key);

      if (current) {
        current.grossAmount = payoutRecord.grossAmount;
        current.platformSharePercent = payoutRecord.platformSharePercent;
        current.platformShareAmount = payoutRecord.platformShareAmount;
        current.driverShareAmount = payoutRecord.driverShareAmount;
        current.tripCount = payoutRecord.tripCount;
        current.status = payoutRecord.status;
        current.paidAt = payoutRecord.paidAt?.toISOString() ?? null;
        current.payoutReference = payoutRecord.payoutReference ?? null;
        current.notes = payoutRecord.notes ?? null;
        settlementRows.set(key, current);
        continue;
      }

      settlementRows.set(key, {
        id: key,
        weekStart: payoutRecord.weekStart.toISOString(),
        weekEnd: payoutRecord.weekEnd.toISOString(),
        tripCount: payoutRecord.tripCount,
        grossAmount: payoutRecord.grossAmount,
        platformSharePercent: payoutRecord.platformSharePercent,
        platformShareAmount: payoutRecord.platformShareAmount,
        driverShareAmount: payoutRecord.driverShareAmount,
        status: payoutRecord.status,
        paidAt: payoutRecord.paidAt?.toISOString() ?? null,
        payoutReference: payoutRecord.payoutReference ?? null,
        notes: payoutRecord.notes ?? null,
        latestCompletedAt: payoutRecord.updatedAt.toISOString(),
        trips: []
      });
    }

    const weeklySettlementRows = Array.from(settlementRows.values()).sort((left, right) =>
      right.weekStart.localeCompare(left.weekStart)
    );

    const currentWeekSummary = paidCompletedBookings.reduce<{
      tripCount: number;
      grossAmount: number;
      driverShareAmount: number;
    }>(
      (totals, booking: (typeof paidCompletedBookings)[number]) => {
        const settlementDate = booking.completedAt ?? booking.payment?.recordedAt ?? booking.updatedAt;
        const weekStart = getSettlementWeekStart(settlementDate);
        if (weekStart.getTime() !== currentWeekStartTime) {
          return totals;
        }

        const grossAmount = Number(booking.payment?.amount ?? booking.fareEstimate ?? 0);
        totals.tripCount += 1;
        totals.grossAmount = Number((totals.grossAmount + grossAmount).toFixed(2));
        totals.driverShareAmount = Number((totals.driverShareAmount + (grossAmount * driverSharePercent) / 100).toFixed(2));
        return totals;
      },
      {
        tripCount: 0,
        grossAmount: 0,
        driverShareAmount: 0
      }
    );

    const lifetimeGrossAmount = paidCompletedBookings.reduce(
      (sum: number, booking: (typeof paidCompletedBookings)[number]) =>
        Number((sum + Number(booking.payment?.amount ?? booking.fareEstimate ?? 0)).toFixed(2)),
      0
    );
    const lifetimeDriverShareAmount = Number(((lifetimeGrossAmount * driverSharePercent) / 100).toFixed(2));
    const paidOutDriverShareAmount = Number(
      payoutRecords
        .filter((record) => record.status === "PAID")
        .reduce((sum: number, record: { driverShareAmount: number }) => sum + record.driverShareAmount, 0)
        .toFixed(2)
    );
    const outstandingDriverShareAmount = Number(
      payoutRecords
        .filter((record) => record.status !== "PAID")
        .reduce((sum: number, record: { driverShareAmount: number }) => sum + record.driverShareAmount, 0)
        .toFixed(2)
    );

    response.json({
      ...driver,
      ratingSummary: {
        averageScore: ratingAggregate._avg.score,
        totalRatings: ratingAggregate._count._all
      },
      settlementConfig: {
        platformSharePercent,
        driverSharePercent
      },
      settlementSummary: {
        completedPaidTripsCount: paidCompletedBookings.length,
        lifetimeGrossAmount,
        lifetimeDriverShareAmount,
        outstandingDriverShareAmount,
        paidOutDriverShareAmount,
        currentWeekTripCount: currentWeekSummary.tripCount,
        currentWeekGrossAmount: currentWeekSummary.grossAmount,
        currentWeekDriverShareAmount: currentWeekSummary.driverShareAmount
      },
      weeklySettlementRows
    });
  })
);

driversRoutes.patch(
  "/drivers/me/availability",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const availabilityStatus = Boolean(request.body?.availabilityStatus);

    const driver = await prisma.driver.update({
      where: { userId: request.auth!.userId },
      data: {
        availabilityStatus
      }
    });

    response.json(driver);
  })
);

driversRoutes.patch(
  "/drivers/me/location",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const schema = z.object({
      latitude: z.coerce.number().min(-90).max(90),
      longitude: z.coerce.number().min(-180).max(180),
      zoneCode: z.string().min(3).optional()
    });
    const input = schema.parse(request.body);

    const zone = input.zoneCode
      ? await prisma.serviceZone.findFirst({
          where: { code: input.zoneCode }
        })
      : null;

    const driver = await prisma.driver.update({
      where: { userId: request.auth!.userId },
      data: {
        currentLatitude: input.latitude,
        currentLongitude: input.longitude,
        locationUpdatedAt: new Date(),
        currentZoneId: zone?.id
      }
    });

    response.json(driver);
  })
);

driversRoutes.get(
  "/drivers/available-requests",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { userId: request.auth!.userId }
    });

    const bookings = await prisma.booking.findMany({
      where: {
        status: "PENDING",
        dispatches: {
          some: {
            driverId: driver.id,
            status: "PENDING"
          }
        }
      },
      include: {
        dispatches: {
          where: {
            driverId: driver.id
          },
          take: 1
        }
      },
      orderBy: {
        scheduledStartAt: "asc"
      },
      take: 25
    });

    response.json(bookings);
  })
);
