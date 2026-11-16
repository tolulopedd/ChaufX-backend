import { createHash, randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { Router } from "express";
import { BookingStatus, PaymentStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { env } from "../../config/env.js";
import { hashPassword } from "../../lib/auth.js";
import { sendTransactionalEmail } from "../../lib/email.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBookingStartTime } from "../bookings/bookings.routes.js";
import { createBookingRecord, resolveBookingPricing } from "../bookings/booking.service.js";
import { createStripeCheckoutSession } from "../payments/payments.routes.js";
import { cancelStripePaymentIntent } from "../payments/payments.routes.js";
import { releaseFirstRidePromotion } from "../promotions/first-ride-promotion.service.js";

export const guestBookingsRoutes = Router();

const publicGuestBookingLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const guestBookingSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  phone: z.string().trim().min(7).max(32),
  requestType: z.enum(["NOW", "LATER"]),
  pickupLocation: z.string().trim().min(3).max(300),
  pickupLat: z.coerce.number().min(-90).max(90),
  pickupLng: z.coerce.number().min(-180).max(180),
  destinationLocation: z.string().trim().min(3).max(300),
  destinationLat: z.coerce.number().min(-90).max(90),
  destinationLng: z.coerce.number().min(-180).max(180),
  scheduledStartAt: z.coerce.date(),
  expectedDurationMinutes: z.coerce.number().int().min(120).max(720),
  vehicleDetails: z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, z.string().trim().min(2).max(300).optional()),
  specialNotes: z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, z.string().trim().max(1000).optional()),
  zoneCode: z.string().trim().min(3).max(100),
  utm: z.object({
    source: z.string().trim().max(120).optional(),
    medium: z.string().trim().max(120).optional(),
    campaign: z.string().trim().max(160).optional(),
    term: z.string().trim().max(160).optional(),
    content: z.string().trim().max(160).optional(),
    landingPath: z.string().trim().max(500).optional()
  }).optional()
});

function requireGuestBookingEnabled() {
  if (!env.ENABLE_GUEST_BOOKING) {
    throw new AppError("Online guest booking is not available yet.", 404, "GUEST_BOOKING_DISABLED");
  }
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newAccessToken() {
  return randomBytes(32).toString("base64url");
}

function guestBookingUrl(token: string, paymentPending = false) {
  const url = new URL("/booking/confirmation", env.CLIENT_APP_URL);
  url.searchParams.set("access", token);
  if (paymentPending) url.searchParams.set("payment", "pending");
  return url.toString();
}

async function getGuestBookingByToken(token: string) {
  const guestBooking = await prisma.guestBooking.findUnique({
    where: { accessTokenHash: tokenHash(token) },
    include: {
      booking: { include: { payment: true, assignedDriver: { include: { user: { select: { fullName: true } } } } } }
    }
  });
  if (!guestBooking || guestBooking.accessTokenExpiresAt <= new Date()) {
    throw new AppError("This secure booking link is invalid or has expired.", 404, "GUEST_BOOKING_ACCESS_INVALID");
  }
  return guestBooking;
}

function guestBookingResponse(guestBooking: Awaited<ReturnType<typeof getGuestBookingByToken>>) {
  const booking = guestBooking.booking;
  return {
    reference: `CHX-${booking.id.replace(/-/g, "").slice(-8).toUpperCase()}`,
    booking: {
      id: booking.id,
      requestType: booking.requestType,
      pickupLocation: booking.pickupLocation,
      destinationLocation: booking.destinationLocation,
      scheduledStartAt: booking.scheduledStartAt,
      expectedDurationMinutes: booking.expectedDurationMinutes,
      vehicleDetails: booking.vehicleDetails,
      specialNotes: booking.specialNotes,
      fareEstimate: booking.fareEstimate,
      currency: booking.payment?.currency ?? "CAD",
      status: booking.status,
      paymentStatus: booking.payment?.status ?? PaymentStatus.PENDING,
      assignedDriverName: booking.assignedDriver?.user.fullName ?? null
    },
    claimed: Boolean(guestBooking.claimedAt),
    contact: { fullName: guestBooking.fullName, email: guestBooking.email }
  };
}

guestBookingsRoutes.post(
  "/guest-bookings/estimate",
  publicGuestBookingLimiter,
  asyncHandler(async (request, response) => {
    requireGuestBookingEnabled();
    const input = guestBookingSchema.pick({
      requestType: true, pickupLocation: true, pickupLat: true, pickupLng: true,
      destinationLocation: true, destinationLat: true, destinationLng: true,
      scheduledStartAt: true, expectedDurationMinutes: true, zoneCode: true
    }).parse(request.body);
    if (!validateBookingStartTime(input.requestType, input.scheduledStartAt)) {
      throw new AppError(input.requestType === "NOW" ? "Book Now requests must start in the future." : "Schedule Later requests must start at least one hour from now.", 400, "INVALID_BOOKING_START_TIME");
    }
    // Guests are intentionally quoted the standard (non-member) rate. Membership
    // pricing remains available after an existing customer signs in.
    const pricing = await resolveBookingPricing({ ...input, customerUserId: undefined });
    if (!pricing.pricingAvailable) throw new AppError(pricing.pricingUnavailableMessage ?? "Pricing is unavailable for this pickup location.", 409, "PRICING_UNAVAILABLE");
    response.json({
      fareEstimate: pricing.fareEstimate,
      currency: "CAD",
      flatFeePerHour: pricing.flatFee,
      minHours: Math.max(2, pricing.minHours),
      billableHours: pricing.billableHours,
      membershipApplied: false,
      promotionOriginalFare: pricing.firstRidePromotion.originalFare,
      promotionDiscountAmount: pricing.firstRidePromotion.discountAmount
    });
  })
);

guestBookingsRoutes.post(
  "/guest-bookings",
  publicGuestBookingLimiter,
  asyncHandler(async (request, response) => {
    requireGuestBookingEnabled();
    const input = guestBookingSchema.parse(request.body);
    if (!validateBookingStartTime(input.requestType, input.scheduledStartAt)) {
      throw new AppError(input.requestType === "NOW" ? "Book Now requests must start in the future." : "Schedule Later requests must start at least one hour from now.", 400, "INVALID_BOOKING_START_TIME");
    }

    const accessToken = newAccessToken();
    const guestIdentity = randomBytes(18).toString("hex");
    // A non-login customer record preserves all existing Booking foreign keys and
    // lets dispatch remain untouched. The guest's real contact data is held only
    // in GuestBooking and can be securely claimed later.
    const guestUser = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: `guest-${guestIdentity}@guest.chaufx.invalid`,
        phone: input.phone,
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        role: UserRole.CUSTOMER,
        customerProfile: { create: { savedAddresses: [] } }
      },
      include: { customerProfile: true }
    });
    const booking = await createBookingRecord({
      customerId: guestUser.customerProfile!.id,
      customerUserId: guestUser.id,
      requestType: input.requestType,
      pickupLocation: input.pickupLocation,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      destinationLocation: input.destinationLocation,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      scheduledStartAt: input.scheduledStartAt,
      expectedDurationMinutes: input.expectedDurationMinutes,
      vehicleDetails: input.vehicleDetails,
      specialNotes: input.specialNotes,
      zoneCode: input.zoneCode
    });
    const guestBooking = await prisma.guestBooking.create({
      data: {
        bookingId: booking.id,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        accessTokenHash: tokenHash(accessToken),
        accessTokenExpiresAt: new Date(Date.now() + env.GUEST_BOOKING_ACCESS_TTL_DAYS * 24 * 60 * 60_000),
        utmSource: input.utm?.source,
        utmMedium: input.utm?.medium,
        utmCampaign: input.utm?.campaign,
        utmTerm: input.utm?.term,
        utmContent: input.utm?.content,
        landingPath: input.utm?.landingPath
      }
    });
    const accessUrl = guestBookingUrl(accessToken);
    void sendTransactionalEmail({
      to: input.email,
      subject: "Your ChaufX booking is ready for payment",
      html: `<p>Hello ${input.fullName},</p><p>Your ChaufX booking has been created. Complete secure payment to start driver matching.</p><p><a href="${accessUrl}">View your booking</a></p>`,
      text: `Hello ${input.fullName}, your ChaufX booking is ready for payment. View it securely: ${accessUrl}`
    }).catch((error) => console.error("Unable to send guest booking email", error));
    response.status(201).json({
      accessToken,
      accessUrl,
      reference: `CHX-${booking.id.replace(/-/g, "").slice(-8).toUpperCase()}`,
      booking: { id: booking.id, fareEstimate: booking.fareEstimate, currency: "CAD", status: booking.status }
    });
  })
);

guestBookingsRoutes.get(
  "/guest-bookings/:accessToken",
  publicGuestBookingLimiter,
  asyncHandler(async (request, response) => {
    requireGuestBookingEnabled();
    response.json(guestBookingResponse(await getGuestBookingByToken(paramValue(request.params.accessToken))));
  })
);

guestBookingsRoutes.post(
  "/guest-bookings/:accessToken/checkout-session",
  publicGuestBookingLimiter,
  asyncHandler(async (request, response) => {
    requireGuestBookingEnabled();
    const token = paramValue(request.params.accessToken);
    const guestBooking = await getGuestBookingByToken(token);
    const booking = guestBooking.booking;
    if (booking.status !== BookingStatus.AWAITING_PAYMENT && booking.status !== BookingStatus.PENDING) {
      throw new AppError("Payment is not available for this booking.", 409, "PAYMENT_NOT_READY");
    }
    if (booking.payment?.status === PaymentStatus.AUTHORIZED || booking.payment?.status === PaymentStatus.CAPTURED) {
      response.json({ alreadyPaid: true, payment: booking.payment });
      return;
    }
    // Book Now holds the card and captures only on driver acceptance. Scheduled
    // bookings charge immediately, as requested, so their card authorization
    // cannot expire before the booked date.
    const manualCapture = booking.requestType === "NOW";
    const returnUrl = guestBookingUrl(token);
    const session = await createStripeCheckoutSession({
      bookingId: booking.id,
      amount: booking.fareEstimate,
      currency: "CAD",
      customerEmail: guestBooking.email,
      description: manualCapture
        ? "Your card will be authorized now and charged only after a driver accepts."
        : "Payment for your scheduled ChaufX trip.",
      successReturnUrl: returnUrl,
      // Stripe's cancel/back control returns the customer to their pending
      // booking, rather than to a fresh form or a loading state.
      cancelReturnUrl: guestBookingUrl(token, true),
      manualCapture,
      publicApiBaseUrl: env.API_PUBLIC_URL
    });
    const payment = await prisma.payment.upsert({
      where: { bookingId: booking.id },
      create: { bookingId: booking.id, amount: booking.fareEstimate, currency: "CAD", status: PaymentStatus.PENDING, providerReference: session.id, stripeCheckoutSessionId: session.id, notes: manualCapture ? "Guest card authorization pending." : "Guest scheduled booking payment pending." },
      update: { amount: booking.fareEstimate, currency: "CAD", status: PaymentStatus.PENDING, providerReference: session.id, stripeCheckoutSessionId: session.id, stripePaymentIntentId: null, notes: manualCapture ? "Guest card authorization pending." : "Guest scheduled booking payment pending." }
    });
    response.status(201).json({ checkoutUrl: session.url, sessionId: session.id, payment });
  })
);

guestBookingsRoutes.post(
  "/guest-bookings/:accessToken/cancel",
  publicGuestBookingLimiter,
  asyncHandler(async (request, response) => {
    requireGuestBookingEnabled();
    const guestBooking = await getGuestBookingByToken(paramValue(request.params.accessToken));
    const booking = guestBooking.booking;
    if ((booking.status !== BookingStatus.AWAITING_PAYMENT && booking.status !== BookingStatus.PENDING) || booking.assignedDriverId) {
      throw new AppError("This booking can no longer be cancelled online. Please contact ChaufX support.", 409, "BOOKING_CANCELLATION_LOCKED");
    }
    if (booking.payment?.status === PaymentStatus.AUTHORIZED && booking.payment.stripePaymentIntentId) {
      await cancelStripePaymentIntent(booking.payment.stripePaymentIntentId, `chaufx-guest-cancel-${booking.payment.id}`);
    }
    await prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payment: true } });
      if (current.status === BookingStatus.CANCELLED) return;
      await tx.booking.update({ where: { id: current.id }, data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() } });
      if (current.payment && current.payment.status !== PaymentStatus.CAPTURED) {
        await tx.payment.update({ where: { id: current.payment.id }, data: { status: current.payment.status === PaymentStatus.AUTHORIZED ? PaymentStatus.AUTHORIZATION_RELEASED : PaymentStatus.FAILED, authorizationReleasedAt: new Date(), notes: "Guest booking cancelled by secure access link." } });
      }
      await releaseFirstRidePromotion(tx, current.id);
    });
    response.json({ cancelled: true });
  })
);

guestBookingsRoutes.post(
  "/guest-bookings/:accessToken/claim",
  requireAuth,
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    requireGuestBookingEnabled();
    const guestBooking = await getGuestBookingByToken(paramValue(request.params.accessToken));
    const customer = await prisma.customerProfile.findUniqueOrThrow({ where: { userId: request.auth!.userId } });
    if (guestBooking.claimedAt && guestBooking.claimedByUserId !== request.auth!.userId) throw new AppError("This booking has already been claimed.", 409, "GUEST_BOOKING_ALREADY_CLAIMED");
    await prisma.$transaction([
      prisma.booking.update({ where: { id: guestBooking.bookingId }, data: { customerId: customer.id } }),
      prisma.guestBooking.update({ where: { id: guestBooking.id }, data: { claimedAt: new Date(), claimedByUserId: request.auth!.userId } })
    ]);
    response.json({ claimed: true, bookingId: guestBooking.bookingId });
  })
);
