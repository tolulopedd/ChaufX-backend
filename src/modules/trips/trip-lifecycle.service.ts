import { BookingStatus, TripStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { notifyUsers } from "../../lib/notifications.js";
import { redeemFirstRidePromotion } from "../promotions/first-ride-promotion.service.js";

type ActiveTripBooking = Awaited<ReturnType<typeof findActiveTripBooking>>;

async function findActiveTripBooking(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      trip: true,
      customer: { select: { userId: true } },
      assignedDriver: { select: { userId: true } }
    }
  });
}

export function paidTripEndAt(startedAt: Date, expectedDurationMinutes: number) {
  return new Date(startedAt.getTime() + expectedDurationMinutes * 60_000);
}

export function isTripExtensionReminderDue(endsAt: Date, now = new Date()) {
  const remainingMs = endsAt.getTime() - now.getTime();
  return remainingMs > 0 && remainingMs <= 15 * 60_000;
}

function tripEndAt(booking: NonNullable<ActiveTripBooking>) {
  return booking.trip?.startedAt
    ? paidTripEndAt(booking.trip.startedAt, booking.expectedDurationMinutes)
    : null;
}

export async function completePaidTrip(bookingId: string, endedAt = new Date()) {
  const booking = await findActiveTripBooking(bookingId);
  if (!booking || booking.status !== BookingStatus.ACTIVE || !booking.trip?.startedAt) {
    return null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.tripStop.updateMany({
      where: { tripId: booking.trip!.id, completedAt: null },
      data: { completedAt: endedAt }
    });

    const completed = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.COMPLETED,
        completedAt: endedAt,
        trip: {
          update: {
            status: TripStatus.COMPLETED,
            endedAt,
            navigationEnabled: false,
            liveTrackingEnabled: false
          }
        }
      },
      include: { trip: true, payment: true }
    });
    await redeemFirstRidePromotion(tx, booking.id, endedAt);
    return completed;
  });

  return { booking, updated };
}

export async function sendTripExtensionReminders(limit = 50) {
  const now = new Date();
  const activeBookings = await prisma.booking.findMany({
    where: {
      status: BookingStatus.ACTIVE,
      trip: { is: { startedAt: { not: null }, extensionReminderSentAt: null } }
    },
    include: {
      trip: true,
      customer: { select: { userId: true } },
      assignedDriver: { select: { userId: true } }
    },
    take: limit,
    orderBy: { updatedAt: "asc" }
  });

  for (const booking of activeBookings) {
    const endsAt = tripEndAt(booking);
    if (!endsAt || !isTripExtensionReminderDue(endsAt, now)) {
      continue;
    }

    const marked = await prisma.trip.updateMany({
      where: { id: booking.trip!.id, extensionReminderSentAt: null },
      data: { extensionReminderSentAt: now }
    });
    if (!marked.count) {
      continue;
    }

    const notifications = [
      {
        userId: booking.customer.userId,
        type: "TRIP_EXTENSION_AVAILABLE" as const,
        title: "15 minutes remaining",
        body: "Extend and pay now to continue your trip. Otherwise, the trip ends when the booked time expires.",
        channel: "PUSH" as const,
        meta: { bookingId: booking.id }
      }
    ];
    if (booking.assignedDriver?.userId) {
      notifications.push({
        userId: booking.assignedDriver.userId,
        type: "TRIP_EXTENSION_AVAILABLE" as const,
        title: "Trip time ending soon",
        body: "The customer can extend and pay in the app. The trip ends at the booked time unless payment is confirmed.",
        channel: "PUSH" as const,
        meta: { bookingId: booking.id }
      });
    }
    await notifyUsers(notifications);
  }
}

export async function completeExpiredPaidTrips(limit = 50) {
  const activeBookings = await prisma.booking.findMany({
    where: { status: BookingStatus.ACTIVE, trip: { is: { startedAt: { not: null } } } },
    include: { trip: true },
    take: limit,
    orderBy: { updatedAt: "asc" }
  });
  const now = new Date();

  for (const booking of activeBookings) {
    if (!booking.trip?.startedAt) {
      continue;
    }
    const endsAt = new Date(booking.trip.startedAt.getTime() + booking.expectedDurationMinutes * 60_000);
    if (endsAt > now) {
      continue;
    }

    const completed = await completePaidTrip(booking.id, endsAt);
    if (!completed) {
      continue;
    }
    const notifications = [
      {
        userId: completed.booking.customer.userId,
        type: "TRIP_AUTO_ENDED" as const,
        title: "Trip completed",
        body: "Your paid trip time has ended.",
        channel: "PUSH" as const,
        meta: { bookingId: booking.id }
      }
    ];
    if (completed.booking.assignedDriver?.userId) {
      notifications.push({
        userId: completed.booking.assignedDriver.userId,
        type: "TRIP_AUTO_ENDED" as const,
        title: "Trip completed",
        body: "The booked trip time has ended.",
        channel: "PUSH" as const,
        meta: { bookingId: booking.id }
      });
    }
    await notifyUsers(notifications);
  }
}
