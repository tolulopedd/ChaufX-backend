import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const driversRoutes = Router();

driversRoutes.use(requireAuth);

driversRoutes.get(
  "/drivers/me",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { userId: request.auth!.userId },
      include: {
        user: true,
        bookings: {
          orderBy: {
            scheduledStartAt: "asc"
          },
          take: 20
        }
      }
    });

    response.json(driver);
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
