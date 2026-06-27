import { BookingStatus, TripStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { AppError } from "../../common/AppError.js";
import { mapStateForBooking } from "../bookings/booking.service.js";
import { notifyUser, notifyUsers } from "../../lib/notifications.js";

export const tripsRoutes = Router();

tripsRoutes.use(requireAuth);

tripsRoutes.get(
  "/trips/:bookingId/map-state",
  asyncHandler(async (request, response) => {
    response.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.set("Pragma", "no-cache");
    response.set("Expires", "0");

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
      },
      include: {
        payment: true
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

    if (booking.payment?.status !== "RECORDED") {
      throw new AppError(
        "Customer payment must be recorded before you can head to pickup.",
        409,
        "PAYMENT_REQUIRED"
      );
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
      body: "Your driver is on the way to your pickup location now.",
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
      },
      include: {
        payment: true
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

    if (booking.payment?.status !== "RECORDED") {
      throw new AppError(
        "Customer payment must be recorded before the trip can start.",
        409,
        "PAYMENT_REQUIRED"
      );
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
      body: "Your driver has picked you up and the trip is now in progress.",
      channel: "PUSH",
      meta: { bookingId: booking.id }
    });

    response.json(updated);
  })
);

tripsRoutes.post(
  "/trips/:bookingId/arrived",
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

    if (booking.status !== BookingStatus.ENROUTE && booking.status !== BookingStatus.ACCEPTED) {
      throw new AppError("Arrival notice is only available while heading to pickup", 409, "TRIP_NOT_READY");
    }

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: {
        id: booking.customerId
      }
    });

    await notifyUser({
      userId: customer.userId,
      type: "DRIVER_ARRIVED",
      title: "Driver arrived",
      body: "Your driver has arrived at the pickup location.",
      channel: "PUSH",
      meta: { bookingId: booking.id }
    });

    response.json({
      success: true
    });
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
      },
      include: {
        payment: true
      }
    });

    if (booking.assignedDriverId !== driver.id) {
      throw new AppError("You are not assigned to this booking", 403, "FORBIDDEN");
    }

    if (booking.payment?.status !== "RECORDED") {
      throw new AppError(
        "Customer payment must be recorded before this trip can be completed.",
        409,
        "PAYMENT_REQUIRED"
      );
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

    await notifyUsers([
      {
        userId: customer.userId,
        type: "TRIP_COMPLETED",
        title: "Trip completed",
        body: "Your paid trip is complete. You can now review your driver.",
        channel: "PUSH",
        meta: { bookingId: booking.id }
      },
      {
        userId: request.auth!.userId,
        type: "TRIP_COMPLETED",
        title: "Trip completed",
        body: "This trip has been completed and moved to your finished trip history.",
        channel: "IN_APP",
        meta: { bookingId: booking.id }
      }
    ]);

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
