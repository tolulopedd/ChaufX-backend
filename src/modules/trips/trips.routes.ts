import { BookingStatus, TripStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { AppError } from "../../common/AppError.js";
import { mapStateForBooking } from "../bookings/booking.service.js";
import { notifyUser } from "../../lib/notifications.js";

export const tripsRoutes = Router();

tripsRoutes.use(requireAuth);

tripsRoutes.get(
  "/trips/:bookingId/map-state",
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: bookingId
      },
      include: {
        locationUpdates: {
          orderBy: {
            recordedAt: "desc"
          },
          take: 1
        }
      }
    });

    const mapState = mapStateForBooking(booking);

    response.json({
      ...mapState,
      latestDriverLocation: booking.locationUpdates[0]
        ? {
            latitude: booking.locationUpdates[0].latitude,
            longitude: booking.locationUpdates[0].longitude,
            heading: booking.locationUpdates[0].heading,
            recordedAt: booking.locationUpdates[0].recordedAt.toISOString()
          }
        : null
    });
  })
);

tripsRoutes.post(
  "/trips/:bookingId/enroute",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const driver = await prisma.driver.findUniqueOrThrow({
      where: {
        userId: request.auth!.userId
      }
    });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: bookingId
      }
    });

    if (booking.assignedDriverId !== driver.id) {
      throw new AppError("You are not assigned to this booking", 403, "FORBIDDEN");
    }

    const mapState = mapStateForBooking(booking);
    if (booking.status !== BookingStatus.ACCEPTED) {
      throw new AppError("Only accepted trips can be marked en route", 409, "TRIP_NOT_READY");
    }

    if (!mapState.active) {
      throw new AppError("Trip tools are still locked until the scheduled activation window opens", 409, "MAP_LOCKED");
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.ENROUTE,
        trip: {
          update: {
            navigationEnabled: true,
            liveTrackingEnabled: true
          }
        }
      },
      include: {
        trip: true
      }
    });

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: {
        id: booking.customerId
      }
    });

    await notifyUser({
      userId: customer.userId,
      type: "DRIVER_ACCEPTED",
      title: "Driver en route",
      body: "Your driver is heading to the pickup location now.",
      channel: "PUSH",
      meta: { bookingId: booking.id }
    });

    response.json(updated);
  })
);

tripsRoutes.post(
  "/trips/:bookingId/start",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const driver = await prisma.driver.findUniqueOrThrow({
      where: {
        userId: request.auth!.userId
      }
    });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: bookingId
      }
    });

    if (booking.assignedDriverId !== driver.id) {
      throw new AppError("You are not assigned to this booking", 403, "FORBIDDEN");
    }

    const mapState = mapStateForBooking(booking);
    if (booking.status !== BookingStatus.ACCEPTED && booking.status !== BookingStatus.ENROUTE) {
      throw new AppError("Only accepted or en route trips can be started", 409, "TRIP_NOT_READY");
    }

    if (!mapState.active) {
      throw new AppError("Trip navigation is still locked until the scheduled activation window opens", 409, "MAP_LOCKED");
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.ACTIVE,
        trip: {
          update: {
            status: TripStatus.ACTIVE,
            startedAt: new Date(),
            navigationEnabled: true,
            liveTrackingEnabled: true
          }
        }
      },
      include: {
        trip: true
      }
    });

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: {
        id: booking.customerId
      }
    });

    await notifyUser({
      userId: customer.userId,
      type: "TRIP_STARTED",
      title: "Trip started",
      body: "Your driver has started the trip and live tracking is now active.",
      channel: "PUSH",
      meta: { bookingId: booking.id }
    });

    response.json(updated);
  })
);

tripsRoutes.post(
  "/trips/:bookingId/end",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const driver = await prisma.driver.findUniqueOrThrow({
      where: {
        userId: request.auth!.userId
      }
    });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: {
        id: bookingId
      }
    });

    if (booking.assignedDriverId !== driver.id) {
      throw new AppError("You are not assigned to this booking", 403, "FORBIDDEN");
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.COMPLETED,
        completedAt: new Date(),
        trip: {
          update: {
            status: TripStatus.COMPLETED,
            endedAt: new Date(),
            navigationEnabled: false,
            liveTrackingEnabled: false
          }
        },
        payment: {
          upsert: {
            create: {
              amount: booking.fareEstimate,
              status: "PENDING",
              notes: "Recorded as pending settlement placeholder."
            },
            update: {
              amount: booking.fareEstimate
            }
          }
        }
      },
      include: {
        trip: true,
        payment: true
      }
    });

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: {
        id: booking.customerId
      }
    });

    await notifyUser({
      userId: customer.userId,
      type: "TRIP_COMPLETED",
      title: "Trip completed",
      body: "You can now review your driver and record payment.",
      channel: "PUSH",
      meta: { bookingId: booking.id }
    });

    response.json(updated);
  })
);

tripsRoutes.post(
  "/trips/:bookingId/status",
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      status: z.enum(["pending", "accepted", "enroute", "active", "completed", "cancelled"])
    });
    const { status } = schema.parse(request.body);

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: status.toUpperCase() as BookingStatus
      }
    });

    response.json(updated);
  })
);
