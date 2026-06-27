import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { AppError } from "../../common/AppError.js";
import { mapStateForBooking } from "../bookings/booking.service.js";
import { notifyUser } from "../../lib/notifications.js";
import { BookingStatus } from "@prisma/client";

function haversineDistanceKm(startLat: number, startLng: number, endLat: number, endLng: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(endLat - startLat);
  const deltaLng = toRadians(endLng - startLng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(startLat)) * Math.cos(toRadians(endLat)) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
      where: { id: input.bookingId },
      include: {
        customer: {
          include: {
            user: true
          }
        }
      }
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

    const nearPickupDistanceKm = haversineDistanceKm(
      input.latitude,
      input.longitude,
      booking.pickupLat,
      booking.pickupLng
    );

    if (booking.status === BookingStatus.ENROUTE && nearPickupDistanceKm <= 0.35) {
      const alreadyNotified = await prisma.notification.findFirst({
        where: {
          userId: booking.customer.userId,
          type: "DRIVER_ARRIVED",
          meta: {
            path: ["bookingId"],
            equals: booking.id
          }
        }
      });

      if (!alreadyNotified) {
        await notifyUser({
          userId: booking.customer.userId,
          type: "DRIVER_ARRIVED",
          title: "Driver almost there",
          body: "Your driver is almost at the pickup location.",
          channel: "PUSH",
          meta: {
            bookingId: booking.id,
            distanceKm: Number(nearPickupDistanceKm.toFixed(2))
          }
        });
      }
    }

    response.status(201).json(location);
  })
);

locationsRoutes.get(
  "/locations/:bookingId",
  asyncHandler(async (request, response) => {
    response.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.set("Pragma", "no-cache");
    response.set("Expires", "0");

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
