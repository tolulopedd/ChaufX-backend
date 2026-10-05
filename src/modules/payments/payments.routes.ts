import { BookingStatus, PaymentStatus, TripExtensionStatus } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { env } from "../../config/env.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import {
  dispatchBookingToEligibleDrivers
} from "../bookings/booking.service.js";
import { notifyUsers } from "../../lib/notifications.js";
import { isPaymentAuthorizedForDispatch, isPaymentCaptured } from "./payment-status.js";
import { safeCheckoutReturnUrl } from "./checkout-return-url.js";

export const paymentsRoutes = Router();

const bookingInteracRecipientEmail = "payments@chaufx.ca";
const bookingInteracInstructionsTtlMs = 15 * 60 * 1000;

type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status: string;
  status: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  customer_details?: {
    email?: string | null;
  } | null;
  payment_intent?: string | StripePaymentIntent | null;
};

type StripePaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  metadata?: Record<string, string>;
};

function getCheckoutBaseUrl() {
  return env.CLIENT_APP_URL.replace(/\/+$/, "");
}

function getPublicApiBaseUrl(request?: Request) {
  const configuredUrl = new URL(env.API_PUBLIC_URL);
  const isLoopbackUrl = ["localhost", "127.0.0.1", "::1"].includes(configuredUrl.hostname);
  const requestHost = request?.get("host");

  // Android emulators cannot reach the development machine through localhost.
  // When the API itself was reached through 10.0.2.2 (or a LAN address), use
  // that same origin for Stripe's one-time return through this API.
  if (isLoopbackUrl && request && requestHost) {
    return `${request.protocol}://${requestHost}`.replace(/\/+$/, "");
  }

  return configuredUrl.toString().replace(/\/+$/, "");
}

function ensureStripeConfigured() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      "Stripe payment is not configured yet for this environment. Add STRIPE_SECRET_KEY on the backend service.",
      503,
      "PAYMENT_NOT_CONFIGURED"
    );
  }
}

async function createStripeCheckoutSession(input: {
  bookingId: string;
  tripExtensionId?: string;
  amount: number;
  currency: string;
  customerEmail?: string | null;
  description: string;
  productName?: string;
  successReturnUrl?: string | null;
  cancelReturnUrl?: string | null;
  manualCapture?: boolean;
  publicApiBaseUrl: string;
}) {
  ensureStripeConfigured();

  const form = new URLSearchParams();
  form.set("mode", "payment");
  if (input.manualCapture) {
    // Delayed capture is supported for card-based Checkout payments.
    form.set("payment_method_types[0]", "card");
    form.set("payment_intent_data[capture_method]", "manual");
  }
  const successUrlBase = `${input.publicApiBaseUrl}/api/payments/checkout/complete`;
  const successQuery = new URLSearchParams();
  successQuery.set("bookingId", input.bookingId);
  if (input.tripExtensionId) {
    successQuery.set("tripExtensionId", input.tripExtensionId);
  }
  if (input.successReturnUrl) {
    successQuery.set("return_url", input.successReturnUrl);
  }
  form.set("success_url", `${successUrlBase}?${successQuery.toString()}&session_id={CHECKOUT_SESSION_ID}`);
  const cancelUrlBase = `${input.publicApiBaseUrl}/api/payments/checkout/cancel`;
  const cancelQuery = new URLSearchParams();
  cancelQuery.set("bookingId", input.bookingId);
  if (input.tripExtensionId) {
    cancelQuery.set("tripExtensionId", input.tripExtensionId);
  }
  if (input.cancelReturnUrl) {
    cancelQuery.set("return_url", input.cancelReturnUrl);
  }
  form.set("cancel_url", `${cancelUrlBase}?${cancelQuery.toString()}`);
  form.set("client_reference_id", input.tripExtensionId ?? input.bookingId);
  form.set("metadata[bookingId]", input.bookingId);
  if (input.tripExtensionId) {
    form.set("metadata[tripExtensionId]", input.tripExtensionId);
  }
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(input.amount * 100)));
  form.set("line_items[0][price_data][product_data][name]", input.productName ?? "ChaufX trip payment");
  form.set("line_items[0][price_data][product_data][description]", input.description);
  if (input.customerEmail) {
    form.set("customer_email", input.customerEmail);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new AppError(
      payload?.error?.message ?? "Unable to create a Stripe checkout session right now.",
      502,
      "PAYMENT_PROVIDER_ERROR"
    );
  }

  return payload as StripeCheckoutSession;
}

async function syncTripExtensionPayment(extensionId: string, sessionId: string) {
  const extension = await prisma.tripExtension.findUnique({
    where: { id: extensionId },
    include: {
      booking: {
        include: {
          trip: true,
          customer: { select: { userId: true } },
          assignedDriver: { select: { userId: true } }
        }
      }
    }
  });
  if (!extension) {
    throw new AppError("Trip extension not found", 404, "TRIP_EXTENSION_NOT_FOUND");
  }

  const session = await retrieveStripeCheckoutSession(sessionId);
  if (session.client_reference_id && session.client_reference_id !== extension.id) {
    throw new AppError("This checkout session does not belong to the requested extension", 409, "PAYMENT_EXTENSION_MISMATCH");
  }

  const nextStatus =
    session.payment_status === "paid"
      ? TripExtensionStatus.RECORDED
      : session.status === "expired"
        ? TripExtensionStatus.FAILED
        : TripExtensionStatus.PENDING;

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.tripExtension.findUniqueOrThrow({ where: { id: extension.id } });
    if (current.status === TripExtensionStatus.RECORDED) {
      return { extension: current, bookingExtended: false };
    }

    const updatedExtension = await tx.tripExtension.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        providerReference: session.id,
        recordedAt: nextStatus === TripExtensionStatus.RECORDED ? new Date() : null
      }
    });
    if (nextStatus !== TripExtensionStatus.RECORDED) {
      return { extension: updatedExtension, bookingExtended: false };
    }

    if (extension.booking.status !== BookingStatus.ACTIVE || !extension.booking.trip?.startedAt) {
      throw new AppError("The trip is no longer active and cannot be extended.", 409, "TRIP_EXTENSION_NOT_AVAILABLE");
    }
    await tx.booking.update({
      where: { id: extension.bookingId },
      data: {
        expectedDurationMinutes: { increment: extension.addedDurationMinutes },
        trip: { update: { extensionReminderSentAt: null } }
      }
    });
    return { extension: updatedExtension, bookingExtended: true };
  });

  if (result.bookingExtended) {
    const hours = extension.addedDurationMinutes / 60;
    const notifications = [
      {
        userId: extension.booking.customer.userId,
        type: "TRIP_EXTENDED" as const,
        title: "Trip extended",
        body: `Your trip has been extended by ${hours} hour${hours === 1 ? "" : "s"}.`,
        channel: "PUSH" as const,
        meta: { bookingId: extension.bookingId, tripExtensionId: extension.id }
      }
    ];
    if (extension.booking.assignedDriver?.userId) {
      notifications.push({
        userId: extension.booking.assignedDriver.userId,
        type: "TRIP_EXTENDED" as const,
        title: "Trip extended",
        body: `The customer added ${hours} paid hour${hours === 1 ? "" : "s"} to this trip.`,
        channel: "PUSH" as const,
        meta: { bookingId: extension.bookingId, tripExtensionId: extension.id }
      });
    }
    await notifyUsers(notifications);
  }

  return result.extension;
}

async function retrieveStripeCheckoutSession(sessionId: string) {
  ensureStripeConfigured();

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent`, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
    }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new AppError(
      payload?.error?.message ?? "Unable to verify the Stripe checkout session.",
      502,
      "PAYMENT_PROVIDER_ERROR"
    );
  }

  return payload as StripeCheckoutSession;
}

async function stripePaymentIntentRequest(
  paymentIntentId: string,
  action?: "capture" | "cancel",
  idempotencyKey?: string
) {
  ensureStripeConfigured();
  const suffix = action ? `/${action}` : "";
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}${suffix}`, {
    method: action ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(action ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: action ? "" : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new AppError(
      payload?.error?.message ?? `Unable to ${action ?? "retrieve"} the Stripe payment authorization.`,
      502,
      "PAYMENT_PROVIDER_ERROR"
    );
  }
  return payload as StripePaymentIntent;
}

export async function captureStripePaymentIntent(paymentIntentId: string, idempotencyKey: string) {
  const current = await stripePaymentIntentRequest(paymentIntentId);
  if (current.status === "succeeded") {
    return current;
  }
  if (current.status !== "requires_capture") {
    throw new AppError("The card authorization can no longer be captured.", 409, "PAYMENT_NOT_CAPTURABLE");
  }
  return stripePaymentIntentRequest(paymentIntentId, "capture", idempotencyKey);
}

export async function cancelStripePaymentIntent(paymentIntentId: string, idempotencyKey: string) {
  const current = await stripePaymentIntentRequest(paymentIntentId);
  if (current.status === "canceled" || current.status === "succeeded") {
    return current;
  }
  return stripePaymentIntentRequest(paymentIntentId, "cancel", idempotencyKey);
}

export async function expireStripeCheckoutSession(sessionId: string) {
  if (!env.STRIPE_SECRET_KEY || !sessionId.startsWith("cs_")) {
    return;
  }

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
    }
  });

  if (response.ok) {
    return;
  }

  const payload = await response.json();
  if (payload?.error?.code === "checkout_session_expired") {
    return;
  }

  throw new AppError(
    payload?.error?.message ?? "Unable to cancel the Stripe checkout session right now.",
    502,
    "PAYMENT_PROVIDER_ERROR"
  );
}

async function getCustomerOwnedBooking(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: {
        include: {
          user: true
        }
      },
      payment: true,
      rating: true
    }
  });

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.customer.userId !== userId) {
    throw new AppError("You can only manage payment for your own bookings", 403, "FORBIDDEN");
  }

  return booking;
}

function paymentStatusFromStripe(session: StripeCheckoutSession, intent: StripePaymentIntent | null): PaymentStatus {
  if (intent?.status === "requires_capture") return PaymentStatus.AUTHORIZED;
  if (intent?.status === "succeeded") return PaymentStatus.CAPTURED;
  if (intent?.status === "canceled") return PaymentStatus.AUTHORIZATION_RELEASED;
  if (intent && ["requires_payment_method", "requires_action", "processing"].includes(intent.status)) return PaymentStatus.PENDING;
  if (session.status === "expired") return PaymentStatus.FAILED;
  return PaymentStatus.PENDING;
}

export async function syncPaymentRecord(bookingId: string, sessionId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      payment: true
    }
  });

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  const session = await retrieveStripeCheckoutSession(sessionId);

  if (session.client_reference_id && session.client_reference_id !== bookingId) {
    throw new AppError("This checkout session does not belong to the requested booking", 409, "PAYMENT_BOOKING_MISMATCH");
  }

  const paymentIntent = typeof session.payment_intent === "string"
    ? await stripePaymentIntentRequest(session.payment_intent)
    : session.payment_intent ?? null;
  const proposedStatus = paymentStatusFromStripe(session, paymentIntent);
  const nextStatus = isPaymentCaptured(booking.payment?.status)
    ? booking.payment!.status
    : booking.payment?.status === PaymentStatus.AUTHORIZATION_RELEASED
      ? PaymentStatus.AUTHORIZATION_RELEASED
      : proposedStatus;
  const now = new Date();

  const payment = await prisma.payment.upsert({
    where: { bookingId },
    create: {
      bookingId,
      amount: booking.fareEstimate,
      currency: "CAD",
      status: nextStatus,
      providerReference: session.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntent?.id,
      authorizedAmount: nextStatus === PaymentStatus.AUTHORIZED && paymentIntent ? paymentIntent.amount / 100 : null,
      capturedAmount: nextStatus === PaymentStatus.CAPTURED && paymentIntent ? (paymentIntent.amount_received ?? paymentIntent.amount) / 100 : null,
      authorizedAt: nextStatus === PaymentStatus.AUTHORIZED ? now : null,
      capturedAt: nextStatus === PaymentStatus.CAPTURED ? now : null,
      authorizationReleasedAt: nextStatus === PaymentStatus.AUTHORIZATION_RELEASED ? now : null,
      recordedAt: nextStatus === PaymentStatus.CAPTURED ? now : null,
      notes:
        nextStatus === PaymentStatus.AUTHORIZED
          ? "Stripe card authorization confirmed; capture occurs when a driver accepts."
          : nextStatus === PaymentStatus.CAPTURED
          ? "Stripe card authorization captured after driver acceptance."
          : nextStatus === PaymentStatus.AUTHORIZATION_RELEASED
            ? "Stripe card authorization released."
          : nextStatus === PaymentStatus.FAILED
            ? "Stripe Checkout session expired before payment completed."
            : "Awaiting Stripe Checkout payment completion."
    },
    update: {
      amount: booking.fareEstimate,
      currency: "CAD",
      status: nextStatus,
      providerReference: session.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntent?.id ?? booking.payment?.stripePaymentIntentId,
      authorizedAmount: nextStatus === PaymentStatus.AUTHORIZED ? paymentIntent!.amount / 100 : booking.payment?.authorizedAmount,
      capturedAmount: nextStatus === PaymentStatus.CAPTURED ? (paymentIntent!.amount_received ?? paymentIntent!.amount) / 100 : booking.payment?.capturedAmount,
      authorizedAt: nextStatus === PaymentStatus.AUTHORIZED ? booking.payment?.authorizedAt ?? now : booking.payment?.authorizedAt,
      capturedAt: nextStatus === PaymentStatus.CAPTURED ? booking.payment?.capturedAt ?? now : booking.payment?.capturedAt,
      authorizationReleasedAt: nextStatus === PaymentStatus.AUTHORIZATION_RELEASED ? booking.payment?.authorizationReleasedAt ?? now : booking.payment?.authorizationReleasedAt,
      recordedAt: nextStatus === PaymentStatus.CAPTURED ? booking.payment?.recordedAt ?? now : booking.payment?.recordedAt,
      notes:
        nextStatus === PaymentStatus.AUTHORIZED
          ? "Stripe card authorization confirmed; capture occurs when a driver accepts."
          : nextStatus === PaymentStatus.CAPTURED
          ? "Stripe card authorization captured after driver acceptance."
          : nextStatus === PaymentStatus.AUTHORIZATION_RELEASED
            ? "Stripe card authorization released."
          : nextStatus === PaymentStatus.FAILED
            ? "Stripe Checkout session expired before payment completed."
            : "Awaiting Stripe Checkout payment completion."
    }
  });

  if (isPaymentAuthorizedForDispatch(nextStatus)) {
    await dispatchBookingToEligibleDrivers(bookingId);
  }

  return payment;
}

async function synchronizePaymentIntent(intent: StripePaymentIntent) {
  const payment = await prisma.payment.findUnique({ where: { stripePaymentIntentId: intent.id } });
  if (!payment) return;
  const now = new Date();
  const status = intent.status === "requires_capture"
    ? PaymentStatus.AUTHORIZED
    : intent.status === "succeeded"
      ? PaymentStatus.CAPTURED
      : intent.status === "canceled"
        ? PaymentStatus.AUTHORIZATION_RELEASED
        : intent.status === "requires_payment_method"
          ? PaymentStatus.FAILED
          : PaymentStatus.PENDING;
  if (isPaymentCaptured(payment.status) && status !== PaymentStatus.CAPTURED) return;
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status,
      authorizedAmount: status === PaymentStatus.AUTHORIZED ? intent.amount / 100 : payment.authorizedAmount,
      capturedAmount: status === PaymentStatus.CAPTURED ? (intent.amount_received ?? intent.amount) / 100 : payment.capturedAmount,
      authorizedAt: status === PaymentStatus.AUTHORIZED ? payment.authorizedAt ?? now : payment.authorizedAt,
      capturedAt: status === PaymentStatus.CAPTURED ? payment.capturedAt ?? now : payment.capturedAt,
      authorizationReleasedAt: status === PaymentStatus.AUTHORIZATION_RELEASED ? payment.authorizationReleasedAt ?? now : payment.authorizationReleasedAt,
      recordedAt: status === PaymentStatus.CAPTURED ? payment.recordedAt ?? now : payment.recordedAt
    }
  });
  if (isPaymentAuthorizedForDispatch(status)) await dispatchBookingToEligibleDrivers(payment.bookingId);
}

export const stripeWebhookHandler = asyncHandler(async (request, response) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError("Stripe webhook is not configured.", 503, "PAYMENT_NOT_CONFIGURED");
  }
  const signature = request.header("stripe-signature");
  const rawBody = request.body as Buffer;
  if (!signature || !Buffer.isBuffer(rawBody)) {
    throw new AppError("Invalid Stripe webhook signature.", 400, "INVALID_WEBHOOK");
  }
  const timestamp = signature.split(",").find((part) => part.startsWith("t="))?.slice(2);
  const signatures = signature.split(",").filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const timestampSeconds = Number(timestamp);
  const isCurrentSignature = Number.isSafeInteger(timestampSeconds)
    && Math.abs(Date.now() / 1000 - timestampSeconds) <= 5 * 60;
  const expected = timestamp
    ? createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex")
    : "";
  const verified = signatures.some((value) => value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected)));
  if (!isCurrentSignature || !verified) throw new AppError("Invalid Stripe webhook signature.", 400, "INVALID_WEBHOOK");

  const event = JSON.parse(rawBody.toString("utf8")) as { type: string; data: { object: StripeCheckoutSession | StripePaymentIntent } };
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as StripeCheckoutSession;
    const bookingId = session.client_reference_id ?? session.metadata?.bookingId;
    if (bookingId && !session.metadata?.tripExtensionId) await syncPaymentRecord(bookingId, session.id);
  }
  if (["payment_intent.amount_capturable_updated", "payment_intent.succeeded", "payment_intent.canceled", "payment_intent.payment_failed"].includes(event.type)) {
    await synchronizePaymentIntent(event.data.object as StripePaymentIntent);
  }
  response.json({ received: true });
});

/** Releases card holds for unaccepted requests two hours after their scheduled start. */
export async function releaseExpiredAuthorizedBookings(limit: number = 25) {
  const candidates = await prisma.booking.findMany({
    where: {
      status: { in: [BookingStatus.AWAITING_PAYMENT, BookingStatus.PENDING] },
      assignedDriverId: null,
      scheduledStartAt: { lte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      payment: { is: { status: PaymentStatus.AUTHORIZED } }
    },
    include: { payment: true, customer: { select: { userId: true } } },
    take: limit,
    orderBy: { scheduledStartAt: "asc" }
  });

  for (const candidate of candidates) {
    if (!candidate.payment?.stripePaymentIntentId) {
      continue;
    }

    // Do not hold a database transaction open while waiting for Stripe.
    const intent = await cancelStripePaymentIntent(
      candidate.payment.stripePaymentIntentId,
      `chaufx-expire-release-${candidate.payment.id}`
    );
    if (intent.status === "succeeded") {
      continue;
    }

    let released = false;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${candidate.id} FOR UPDATE`;
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: candidate.id }, include: { payment: true } });
      if (booking.assignedDriverId || booking.status === BookingStatus.CANCELLED || booking.payment?.status !== PaymentStatus.AUTHORIZED) return;
      const now = new Date();
      await tx.payment.update({
        where: { id: booking.payment.id },
        data: { status: PaymentStatus.AUTHORIZATION_RELEASED, authorizationReleasedAt: now, notes: "Card authorization released because no driver accepted within two hours." }
      });
      await tx.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CANCELLED, cancelledAt: now } });
      await tx.bookingDispatch.updateMany({
        where: { bookingId: booking.id, status: "PENDING" },
        data: { status: "EXPIRED", respondedAt: now }
      });
      released = true;
    });
    if (!released) continue;
    await notifyUsers([{
      userId: candidate.customer.userId,
      type: "BOOKING_SUBMITTED",
      title: "Booking expired",
      body: "No driver accepted your booking. Your card authorization has been released.",
      channel: "PUSH",
      meta: { bookingId: candidate.id }
    }]);
  }
  return candidates.length;
}

export const paymentCheckoutCompleteHandler = asyncHandler(async (request, response) => {
  const schema = z.object({
    bookingId: z.string().uuid(),
    tripExtensionId: z.string().uuid().optional(),
    session_id: z.string().min(1),
    return_url: z.string().optional()
  });
  const input = schema.parse(request.query);

  if (input.tripExtensionId) {
    await syncTripExtensionPayment(input.tripExtensionId, input.session_id);
  } else {
    await syncPaymentRecord(input.bookingId, input.session_id);
  }

  const fallbackUrl = `${getCheckoutBaseUrl()}/payment-complete?bookingId=${input.bookingId}&session_id=${encodeURIComponent(input.session_id)}`;
  const redirectUrl = safeCheckoutReturnUrl(input.return_url, fallbackUrl, env.CLIENT_APP_URL);

  redirectUrl.searchParams.set("bookingId", input.bookingId);
  if (input.tripExtensionId) {
    redirectUrl.searchParams.set("tripExtensionId", input.tripExtensionId);
  }
  redirectUrl.searchParams.set("session_id", input.session_id);

  response.redirect(302, redirectUrl.toString());
});

export const paymentCheckoutCancelHandler = asyncHandler(async (request, response) => {
  const schema = z.object({
    bookingId: z.string().uuid(),
    tripExtensionId: z.string().uuid().optional(),
    return_url: z.string().optional()
  });
  const input = schema.parse(request.query);

  const fallbackUrl = `${getCheckoutBaseUrl()}/customer#awaiting-payment`;
  const redirectUrl = safeCheckoutReturnUrl(input.return_url, fallbackUrl, env.CLIENT_APP_URL);
  redirectUrl.searchParams.set("bookingId", input.bookingId);
  if (input.tripExtensionId) {
    redirectUrl.searchParams.set("tripExtensionId", input.tripExtensionId);
  }

  response.redirect(302, redirectUrl.toString());
});

paymentsRoutes.use(requireAuth);

paymentsRoutes.get(
  "/admin/payments/interac",
  requireRole(["admin"]),
  asyncHandler(async (_request, response) => {
    const payments = await prisma.payment.findMany({
      where: {
        providerReference: {
          startsWith: "CHX-TRIP-"
        }
      },
      include: {
        booking: {
          include: {
            customer: {
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    response.json({ payments });
  })
);

paymentsRoutes.get(
  "/payments/:bookingId",
  requireRole(["admin", "customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);

    if (request.auth!.role === "customer") {
      await getCustomerOwnedBooking(bookingId, request.auth!.userId);
    }

    let payment = await prisma.payment.findUnique({
      where: { bookingId }
    });

    if (payment?.providerReference && payment.status === PaymentStatus.PENDING && env.STRIPE_SECRET_KEY) {
      payment = await syncPaymentRecord(bookingId, payment.providerReference);
    }

    response.json(payment);
  })
);

paymentsRoutes.post(
  "/payments/:bookingId/extensions",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const input = z.object({ hours: z.coerce.number().int().min(1).max(12) }).parse(request.body);
    const booking = await getCustomerOwnedBooking(bookingId, request.auth!.userId);

    if (booking.status !== BookingStatus.ACTIVE) {
      throw new AppError("Only an active trip can be extended.", 409, "TRIP_EXTENSION_NOT_AVAILABLE");
    }
    const trip = await prisma.trip.findUnique({ where: { bookingId: booking.id } });
    if (!trip?.startedAt) {
      throw new AppError("Start the trip before adding paid time.", 409, "TRIP_NOT_STARTED");
    }
    if (!isPaymentCaptured(booking.payment?.status)) {
      throw new AppError("The original trip payment must be complete first.", 409, "PAYMENT_REQUIRED");
    }

    const hourlyRate =
      booking.bookedHourlyRate ??
      booking.fareEstimate / Math.max(1, booking.expectedDurationMinutes / 60);
    const pending = await prisma.tripExtension.findFirst({
      where: { bookingId: booking.id, status: TripExtensionStatus.PENDING },
      orderBy: { createdAt: "desc" }
    });
    const extension = pending
      ? await prisma.tripExtension.update({
          where: { id: pending.id },
          data: {
            addedDurationMinutes: input.hours * 60,
            hourlyRate,
            amount: hourlyRate * input.hours,
            providerReference: null
          }
        })
      : await prisma.tripExtension.create({
          data: {
            bookingId: booking.id,
            addedDurationMinutes: input.hours * 60,
            hourlyRate,
            amount: hourlyRate * input.hours,
            currency: "CAD"
          }
        });

    response.status(201).json({ extension });
  })
);

paymentsRoutes.post(
  "/payments/extensions/:extensionId/checkout-session",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const extensionId = paramValue(request.params.extensionId);
    const input = z.object({ successReturnUrl: z.string().optional(), cancelReturnUrl: z.string().optional() }).parse(request.body ?? {});
    const extension = await prisma.tripExtension.findUnique({
      where: { id: extensionId },
      include: { booking: { include: { customer: { include: { user: true } }, trip: true } } }
    });
    if (!extension || extension.booking.customer.userId !== request.auth!.userId) {
      throw new AppError("Trip extension not found", 404, "TRIP_EXTENSION_NOT_FOUND");
    }
    if (extension.status !== TripExtensionStatus.PENDING || extension.booking.status !== BookingStatus.ACTIVE || !extension.booking.trip?.startedAt) {
      throw new AppError("This trip extension is no longer available.", 409, "TRIP_EXTENSION_NOT_AVAILABLE");
    }

    const session = await createStripeCheckoutSession({
      bookingId: extension.bookingId,
      tripExtensionId: extension.id,
      amount: extension.amount,
      currency: extension.currency,
      customerEmail: extension.booking.customer.user.email,
      productName: "ChaufX trip extension",
      description: `${extension.addedDurationMinutes / 60} hour trip extension`,
      successReturnUrl: input.successReturnUrl,
      cancelReturnUrl: input.cancelReturnUrl,
      publicApiBaseUrl: getPublicApiBaseUrl(request)
    });
    await prisma.tripExtension.update({
      where: { id: extension.id },
      data: { providerReference: session.id }
    });
    response.status(201).json({ checkoutUrl: session.url, sessionId: session.id, extensionId: extension.id });
  })
);

paymentsRoutes.post(
  "/payments/extensions/:extensionId/sync",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const extensionId = paramValue(request.params.extensionId);
    const input = z.object({ sessionId: z.string().optional() }).parse(request.body ?? {});
    const extension = await prisma.tripExtension.findUnique({
      where: { id: extensionId },
      include: { booking: { include: { customer: { select: { userId: true } } } } }
    });
    if (!extension || extension.booking.customer.userId !== request.auth!.userId) {
      throw new AppError("Trip extension not found", 404, "TRIP_EXTENSION_NOT_FOUND");
    }
    const sessionId = input.sessionId ?? extension.providerReference;
    if (!sessionId) {
      throw new AppError("No Stripe checkout session is linked to this extension yet.", 409, "PAYMENT_SESSION_MISSING");
    }
    response.json(await syncTripExtensionPayment(extension.id, sessionId));
  })
);

paymentsRoutes.post(
  "/payments/:bookingId/checkout-session",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      successReturnUrl: z.string().optional(),
      cancelReturnUrl: z.string().optional()
    });
    const input = schema.parse(request.body ?? {});
    const booking = await getCustomerOwnedBooking(bookingId, request.auth!.userId);

    if (!["AWAITING_PAYMENT", "PENDING", "ACCEPTED", "ENROUTE", "ACTIVE", "COMPLETED"].includes(String(booking.status))) {
      throw new AppError(
        "Payment is not available for this booking right now.",
        409,
        "PAYMENT_NOT_READY"
      );
    }

    if (isPaymentCaptured(booking.payment?.status)) {
      response.json({
        alreadyPaid: true,
        payment: booking.payment
      });
      return;
    }
    if (booking.payment?.status === PaymentStatus.AUTHORIZED) {
      response.json({ alreadyAuthorized: true, payment: booking.payment });
      return;
    }

    const session = await createStripeCheckoutSession({
      bookingId: booking.id,
      amount: booking.fareEstimate,
      currency: "CAD",
      customerEmail: booking.customer.user.email,
      description: `${booking.pickupLocation} to ${booking.destinationLocation}.`,
      successReturnUrl: input.successReturnUrl,
      cancelReturnUrl: input.cancelReturnUrl,
      manualCapture: true,
      publicApiBaseUrl: getPublicApiBaseUrl(request)
    });

    const payment = await prisma.payment.upsert({
      where: {
        bookingId: booking.id
      },
      create: {
        bookingId: booking.id,
        amount: booking.fareEstimate,
        currency: "CAD",
        status: PaymentStatus.PENDING,
        providerReference: session.id,
        stripeCheckoutSessionId: session.id,
        notes: "Stripe Checkout session created."
      },
      update: {
        amount: booking.fareEstimate,
        currency: "CAD",
        status: PaymentStatus.PENDING,
        providerReference: session.id,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: null,
        authorizedAmount: null,
        capturedAmount: null,
        authorizedAt: null,
        capturedAt: null,
        authorizationReleasedAt: null,
        notes: "Stripe Checkout session created."
      }
    });

    response.status(201).json({
      checkoutUrl: session.url,
      sessionId: session.id,
      payment
    });
  })
);

paymentsRoutes.post(
  "/payments/:bookingId/interac-instructions",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const booking = await getCustomerOwnedBooking(bookingId, request.auth!.userId);

    if (!['AWAITING_PAYMENT', 'PENDING'].includes(String(booking.status))) {
      throw new AppError("Payment is not available for this booking right now.", 409, "PAYMENT_NOT_READY");
    }

    if (booking.payment?.status === PaymentStatus.RECORDED) {
      response.json({ alreadyPaid: true, payment: booking.payment });
      return;
    }

    const now = new Date();
    const reference = `CHX-TRIP-${booking.id.replace(/-/g, "").slice(-10).toUpperCase()}`;
    const hasActiveInstructions =
      booking.payment?.status === PaymentStatus.PENDING &&
      booking.payment.providerReference === reference &&
      booking.payment.interacInstructionsExpiresAt &&
      booking.payment.interacInstructionsExpiresAt > now;
    const expiresAt = hasActiveInstructions
      ? booking.payment!.interacInstructionsExpiresAt!
      : new Date(now.getTime() + bookingInteracInstructionsTtlMs);
    const payment = await prisma.payment.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        amount: booking.fareEstimate,
        currency: "CAD",
        status: PaymentStatus.PENDING,
        providerReference: reference,
        interacInstructionsExpiresAt: expiresAt,
        interacTransferConfirmedAt: null,
        notes: "Interac e-transfer payment requested."
      },
      update: {
        amount: booking.fareEstimate,
        currency: "CAD",
        status: PaymentStatus.PENDING,
        providerReference: reference,
        interacInstructionsExpiresAt: expiresAt,
        interacTransferConfirmedAt: hasActiveInstructions ? booking.payment!.interacTransferConfirmedAt : null,
        notes: "Interac e-transfer payment requested."
      }
    });

    response.status(201).json({
      payment,
      instructions: {
        recipientEmail: bookingInteracRecipientEmail,
        reference,
        amount: payment.amount,
        currency: payment.currency,
        expiresAt: payment.interacInstructionsExpiresAt
      }
    });
  })
);

paymentsRoutes.post(
  "/payments/:bookingId/interac-confirmation",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const booking = await getCustomerOwnedBooking(bookingId, request.auth!.userId);
    const payment = booking.payment;

    if (!payment || payment.status !== PaymentStatus.PENDING || !payment.interacInstructionsExpiresAt) {
      throw new AppError("Create e-transfer instructions before confirming payment.", 409, "INTERAC_INSTRUCTIONS_REQUIRED");
    }

    if (payment.interacInstructionsExpiresAt <= new Date()) {
      throw new AppError("These e-transfer details have expired. Create new details to continue.", 409, "INTERAC_INSTRUCTIONS_EXPIRED");
    }

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        interacTransferConfirmedAt: payment.interacTransferConfirmedAt ?? new Date(),
        notes: "Customer confirmed the Interac e-transfer. Awaiting admin payment confirmation."
      }
    });

    response.json({
      payment: updated,
      bookingStatus: booking.status,
      message: "Booking submitted. Awaiting ChaufX payment confirmation before driver routing."
    });
  })
);

paymentsRoutes.post(
  "/payments/:bookingId/sync",
  requireRole(["admin", "customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      sessionId: z.string().optional()
    });
    const input = schema.parse(request.body);

    if (request.auth!.role === "customer") {
      await getCustomerOwnedBooking(bookingId, request.auth!.userId);
    }

    const existing = await prisma.payment.findUnique({
      where: { bookingId }
    });

    const sessionId = input.sessionId ?? existing?.providerReference;
    if (!sessionId) {
      throw new AppError("No Stripe checkout session is linked to this booking yet.", 409, "PAYMENT_SESSION_MISSING");
    }

    const payment = await syncPaymentRecord(bookingId, sessionId);
    response.json(payment);
  })
);

paymentsRoutes.post(
  "/payments/:bookingId/record",
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      amount: z.coerce.number().positive(),
      providerReference: z.string().optional(),
      notes: z.string().optional()
    });
    const input = schema.parse(request.body);

    const payment = await prisma.payment.upsert({
      where: {
        bookingId
      },
      create: {
        bookingId,
        amount: input.amount,
        currency: "CAD",
        status: PaymentStatus.RECORDED,
        providerReference: input.providerReference,
        notes: input.notes,
        recordedAt: new Date()
      },
      update: {
        amount: input.amount,
        currency: "CAD",
        status: PaymentStatus.RECORDED,
        providerReference: input.providerReference,
        notes: input.notes,
        recordedAt: new Date()
      }
    });

    await dispatchBookingToEligibleDrivers(bookingId);

    response.json(payment);
  })
);
