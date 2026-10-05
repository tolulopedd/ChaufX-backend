import { BookingStatus, NotificationChannel, NotificationType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { notifyUser } from "../../lib/notifications.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";

export const tripMessagesRoutes = Router();

tripMessagesRoutes.use(requireAuth);

const createTripMessageSchema = z.object({
  body: z.string().trim().min(1).max(500)
});

const personalContactPatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?\d[\s().-]*){7,}/,
  /\b(?:https?:\/\/|www\.)\S+/i,
  /\b(?:[a-z0-9-]+\.)+(?:com|ca|net|org|io|me|co)\b/i,
  /@[a-z0-9_]{3,}/i,
  /\b(?:whats?app|telegram|instagram|insta|snapchat|signal|wechat|facebook|facetime)\b/i,
  /\b(?:call|text|email|dm)\s+me\b/i
];

export function containsPersonalContactDetails(body: string) {
  return personalContactPatterns.some((pattern) => pattern.test(body));
}

const chatEnabledStatuses: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.ENROUTE,
  BookingStatus.ACTIVE,
  BookingStatus.COMPLETED
];

async function loadChatBooking(bookingId: string, userId: string, role: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
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
  });

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (!booking.assignedDriver?.userId) {
    throw new AppError("Messages become available after a driver accepts the trip.", 409, "CHAT_UNAVAILABLE");
  }

  if (!chatEnabledStatuses.includes(booking.status)) {
    throw new AppError("Messages are not available for this trip yet.", 409, "CHAT_UNAVAILABLE");
  }

  if (role === "customer" && booking.customer.userId !== userId) {
    throw new AppError("You are not allowed to view messages for this trip.", 403, "FORBIDDEN");
  }

  if (role === "driver" && booking.assignedDriver.userId !== userId) {
    throw new AppError("You are not allowed to view messages for this trip.", 403, "FORBIDDEN");
  }

  if (role !== "customer" && role !== "driver") {
    throw new AppError("You are not allowed to view messages for this trip.", 403, "FORBIDDEN");
  }

  return booking;
}

tripMessagesRoutes.get(
  "/bookings/:bookingId/messages",
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    await loadChatBooking(bookingId, request.auth!.userId, request.auth!.role);

    const messages = await (prisma as any).tripMessage.findMany({
      where: { bookingId },
      include: {
        sender: {
          select: {
            id: true,
            role: true,
            fullName: true
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    response.json(
      messages.map((message: any) => ({
        id: message.id,
        bookingId: message.bookingId,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        sender: {
          id: message.sender.id,
          role: message.sender.role.toLowerCase(),
          fullName: message.sender.fullName
        }
      }))
    );
  })
);

tripMessagesRoutes.post(
  "/bookings/:bookingId/messages",
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const booking = await loadChatBooking(bookingId, request.auth!.userId, request.auth!.role);
    const input = createTripMessageSchema.parse(request.body);

    if (containsPersonalContactDetails(input.body)) {
      throw new AppError(
        "For your safety, keep communication in ChaufX and do not share phone numbers, email addresses, social handles, or external links.",
        422,
        "CONTACT_DETAILS_NOT_ALLOWED"
      );
    }

    const message = await (prisma as any).tripMessage.create({
      data: {
        bookingId,
        senderUserId: request.auth!.userId,
        body: input.body
      },
      include: {
        sender: {
          select: {
            id: true,
            role: true,
            fullName: true
          }
        }
      }
    });

    const recipientUserId =
      request.auth!.role === "driver" ? booking.customer.userId : (booking.assignedDriver?.userId ?? null);

    if (recipientUserId) {
      await notifyUser({
        userId: recipientUserId,
        type: "TRIP_MESSAGE" as NotificationType,
        title: request.auth!.role === "driver" ? "Driver message" : "Customer message",
        body: input.body,
        channel: NotificationChannel.PUSH,
        meta: {
          bookingId,
          messageId: message.id,
          senderRole: request.auth!.role
        }
      });
    }

    response.status(201).json({
      id: message.id,
      bookingId: message.bookingId,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      sender: {
        id: message.sender.id,
        role: message.sender.role.toLowerCase(),
        fullName: message.sender.fullName
      }
    });
  })
);
