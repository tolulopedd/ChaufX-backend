import { BookingStatus, PaymentStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { env } from "../../config/env.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { dispatchBookingToEligibleDrivers } from "../bookings/booking.service.js";

export const paymentsRoutes = Router();

type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status: string;
  status: string;
  client_reference_id?: string | null;
  customer_details?: {
    email?: string | null;
  } | null;
};

function getCheckoutBaseUrl() {
  return env.CLIENT_APP_URL.replace(/\/+$/, "");
}

function getPublicApiBaseUrl() {
  return env.API_PUBLIC_URL.replace(/\/+$/, "");
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
  amount: number;
  currency: string;
  customerEmail?: string | null;
  description: string;
  successReturnUrl?: string | null;
  cancelReturnUrl?: string | null;
}) {
  ensureStripeConfigured();

  const form = new URLSearchParams();
  form.set("mode", "payment");
  const successUrlBase = `${getPublicApiBaseUrl()}/api/payments/checkout/complete`;
  const successQuery = new URLSearchParams();
  successQuery.set("bookingId", input.bookingId);
  if (input.successReturnUrl) {
    successQuery.set("return_url", input.successReturnUrl);
  }
  form.set("success_url", `${successUrlBase}?${successQuery.toString()}&session_id={CHECKOUT_SESSION_ID}`);
  const cancelUrlBase = `${getPublicApiBaseUrl()}/api/payments/checkout/cancel`;
  const cancelQuery = new URLSearchParams();
  cancelQuery.set("bookingId", input.bookingId);
  if (input.cancelReturnUrl) {
    cancelQuery.set("return_url", input.cancelReturnUrl);
  }
  form.set("cancel_url", `${cancelUrlBase}?${cancelQuery.toString()}`);
  form.set("client_reference_id", input.bookingId);
  form.set("metadata[bookingId]", input.bookingId);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(input.amount * 100)));
  form.set("line_items[0][price_data][product_data][name]", "ChaufX trip payment");
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

async function retrieveStripeCheckoutSession(sessionId: string) {
  ensureStripeConfigured();

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
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

async function syncPaymentRecord(bookingId: string, sessionId: string) {
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

  const nextStatus =
    session.payment_status === "paid"
      ? PaymentStatus.RECORDED
      : session.status === "expired"
        ? PaymentStatus.FAILED
        : PaymentStatus.PENDING;

  const payment = await prisma.payment.upsert({
    where: { bookingId },
    create: {
      bookingId,
      amount: booking.fareEstimate,
      currency: "CAD",
      status: nextStatus,
      providerReference: session.id,
      recordedAt: nextStatus === PaymentStatus.RECORDED ? new Date() : null,
      notes:
        nextStatus === PaymentStatus.RECORDED
          ? "Stripe Checkout payment recorded."
          : nextStatus === PaymentStatus.FAILED
            ? "Stripe Checkout session expired before payment completed."
            : "Awaiting Stripe Checkout payment completion."
    },
    update: {
      amount: booking.fareEstimate,
      currency: "CAD",
      status: nextStatus,
      providerReference: session.id,
      recordedAt: nextStatus === PaymentStatus.RECORDED ? booking.payment?.recordedAt ?? new Date() : null,
      notes:
        nextStatus === PaymentStatus.RECORDED
          ? "Stripe Checkout payment recorded."
          : nextStatus === PaymentStatus.FAILED
            ? "Stripe Checkout session expired before payment completed."
            : "Awaiting Stripe Checkout payment completion."
    }
  });

  if (nextStatus === PaymentStatus.RECORDED) {
    await dispatchBookingToEligibleDrivers(bookingId);
  }

  return payment;
}

export const paymentCheckoutCompleteHandler = asyncHandler(async (request, response) => {
  const schema = z.object({
    bookingId: z.string().uuid(),
    session_id: z.string().min(1),
    return_url: z.string().optional()
  });
  const input = schema.parse(request.query);

  await syncPaymentRecord(input.bookingId, input.session_id);

  const fallbackUrl = `${getCheckoutBaseUrl()}/payment-complete?bookingId=${input.bookingId}&session_id=${encodeURIComponent(input.session_id)}`;
  const redirectUrl = input.return_url
    ? new URL(input.return_url)
    : new URL(fallbackUrl);

  redirectUrl.searchParams.set("bookingId", input.bookingId);
  redirectUrl.searchParams.set("session_id", input.session_id);

  response.redirect(302, redirectUrl.toString());
});

export const paymentCheckoutCancelHandler = asyncHandler(async (request, response) => {
  const schema = z.object({
    bookingId: z.string().uuid(),
    return_url: z.string().optional()
  });
  const input = schema.parse(request.query);

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      customer: {
        include: {
          user: true
        }
      },
      payment: true
    }
  });

  if (
    booking &&
    (booking.status === BookingStatus.AWAITING_PAYMENT || booking.status === BookingStatus.PENDING) &&
    !booking.assignedDriverId
  ) {
    if (!booking.payment || booking.payment.status !== PaymentStatus.RECORDED) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CANCELLED
        }
      });
    }
  }

  const fallbackUrl = `${getCheckoutBaseUrl()}/payment-cancelled?bookingId=${input.bookingId}`;
  const redirectUrl = input.return_url ? new URL(input.return_url) : new URL(fallbackUrl);
  redirectUrl.searchParams.set("bookingId", input.bookingId);

  response.redirect(302, redirectUrl.toString());
});

paymentsRoutes.use(requireAuth);

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

    if (booking.payment?.status === PaymentStatus.RECORDED) {
      response.json({
        alreadyPaid: true,
        payment: booking.payment
      });
      return;
    }

    const session = await createStripeCheckoutSession({
      bookingId: booking.id,
      amount: booking.fareEstimate,
      currency: "CAD",
      customerEmail: booking.customer.user.email,
      description: `${booking.pickupLocation} to ${booking.destinationLocation}`,
      successReturnUrl: input.successReturnUrl,
      cancelReturnUrl: input.cancelReturnUrl
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
        notes: "Stripe Checkout session created."
      },
      update: {
        amount: booking.fareEstimate,
        currency: "CAD",
        status: PaymentStatus.PENDING,
        providerReference: session.id,
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
