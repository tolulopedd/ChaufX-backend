import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { AppError } from "../../common/AppError.js";
import { mapStateForBooking } from "../bookings/booking.service.js";

export const locationsRoutes = Router();

locationsRoutes.use(requireAuth);

const locationSchema = z.object({
  bookingId: z.string().uuid(),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  heading: z.coerce.number().optional(),
  speedKph: z.coerce.number().optional(),
  source: z.string().default("mobile")
});

locationsRoutes.post(
  "/locations",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const input = locationSchema.parse(request.body);
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { userId: request.auth!.userId }
    });
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: input.bookingId }
    });

    if (booking.assignedDriverId !== driver.id) {
      throw new AppError("You are not assigned to this booking", 403, "FORBIDDEN");
    }

    const mapState = mapStateForBooking(booking);
    if (!mapState.active) {
      throw new AppError("Live location updates are only available during the active trip window", 409, "MAP_LOCKED");
    }

    const location = await prisma.location.create({
      data: {
        bookingId: input.bookingId,
        driverId: driver.id,
        latitude: input.latitude,
        longitude: input.longitude,
        heading: input.heading,
        speedKph: input.speedKph,
        source: input.source
      }
    });

    response.status(201).json(location);
  })
);

locationsRoutes.get(
  "/locations/:bookingId",
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId }
    });
    const mapState = mapStateForBooking(booking);
    if (!mapState.active && request.auth!.role !== "admin") {
      throw new AppError("Live tracking is currently unavailable for this trip", 409, "MAP_LOCKED");
    }

    const locations = await prisma.location.findMany({
      where: {
        bookingId
      },
      orderBy: {
        recordedAt: "asc"
      }
    });

    response.json(locations);
  })
);
