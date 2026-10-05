import { buildActivationWindow } from "../../lib/app-config.js";
import { BookingDispatchStatus, BookingStatus, PaymentStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { AppError } from "../../common/AppError.js";
import {
  createBookingRecord,
  dispatchBookingToEligibleDrivers,
  driverHasOverlap,
  ensureCustomerCanCancel,
  findEligibleDrivers,
  findMatchingAwaitingPaymentBooking,
  resolveBookingPricing
} from "./booking.service.js";
import { createAuditLog } from "../../lib/audit.js";
import { notifyUser, notifyUsers } from "../../lib/notifications.js";
import { isEligibleCustomerAge } from "../../lib/customer-age.js";
import { cancelStripePaymentIntent, captureStripePaymentIntent, expireStripeCheckoutSession } from "../payments/payments.routes.js";
import { isPaymentCaptured } from "../payments/payment-status.js";

export const createBookingSchema = z.object({
  vehicleId: z.string().uuid().optional(),
  preferredDriverId: z.string().uuid().optional(),
  requestType: z.enum(["NOW", "LATER"]),
  pickupLocation: z.string().min(3),
  pickupLat: z.coerce.number(),
  pickupLng: z.coerce.number(),
  deviceLat: z.coerce.number().min(-90).max(90).optional(),
  deviceLng: z.coerce.number().min(-180).max(180).optional(),
  destinationLocation: z.string().min(3),
  destinationLat: z.coerce.number(),
  destinationLng: z.coerce.number(),
  scheduledStartAt: z.coerce.date(),
  expectedDurationMinutes: z.coerce.number().int().min(60),
  specialNotes: z.string().optional(),
  vehicleDetails: z.string().optional(),
  zoneCode: z.string().min(3)
});

async function captureAuthorizedBookingPayment(
  payment: { id: string; status: PaymentStatus; stripePaymentIntentId: string | null; capturedAt: Date | null; recordedAt: Date | null }
) {
  if (isPaymentCaptured(payment.status)) return null;
  if (payment.status !== PaymentStatus.AUTHORIZED || !payment.stripePaymentIntentId) {
    throw new AppError("This booking does not have a valid card authorization.", 409, "PAYMENT_NOT_AUTHORIZED");
  }
  const intent = await captureStripePaymentIntent(payment.stripePaymentIntentId, `chaufx-booking-capture-${payment.id}`);
  if (intent.status !== "succeeded") {
    throw new AppError("The payment authorization could not be captured.", 409, "PAYMENT_NOT_CAPTURABLE");
  }
  return intent;
}

export function validateBookingStartTime(requestType: "NOW" | "LATER", scheduledStartAt: Date, now: Date = new Date()) {
  if (requestType === "NOW") {
    return scheduledStartAt.getTime() >= now.getTime();
  }

  return scheduledStartAt.getTime() >= now.getTime() + 60 * 60_000;
}

const estimateBookingSchema = z.object({
  scheduledStartAt: z.coerce.date(),
  expectedDurationMinutes: z.coerce.number().int().min(60),
  zoneCode: z.string().min(3),
  pickupLocation: z.string().min(3).optional(),
  destinationLocation: z.string().min(3).optional(),
  pickupLat: z.coerce.number().min(-90).max(90).optional(),
  pickupLng: z.coerce.number().min(-180).max(180).optional(),
  deviceLat: z.coerce.number().min(-90).max(90).optional(),
  deviceLng: z.coerce.number().min(-180).max(180).optional()
});

const preferredDriversSchema = z.object({
  requestType: z.enum(["NOW", "LATER"]),
  pickupLocation: z.string().min(3),
  pickupLat: z.coerce.number().min(-90).max(90),
  pickupLng: z.coerce.number().min(-180).max(180),
  scheduledStartAt: z.coerce.date(),
  expectedDurationMinutes: z.coerce.number().int().min(60),
  zoneCode: z.string().min(3)
});

export const bookingsRoutes = Router();

bookingsRoutes.use(requireAuth);

function formatCustomerDisplayName(fullName: string) {
  const [firstName = "Customer", ...remainingNames] = fullName.trim().split(/\s+/);
  const lastInitial = remainingNames.at(-1)?.[0];

  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}

function formatPreferredDriverName(fullName: string) {
  const [firstName = "Driver", ...remainingNames] = fullName.trim().split(/\s+/);
  const lastInitial = remainingNames.at(-1)?.[0];

  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}

async function ensurePreferredDriverWasUsedBefore(customerId: string, customerUserId: string, preferredDriverId?: string) {
  if (!preferredDriverId) {
    return;
  }

  const priorRatedTrip = await prisma.booking.findFirst({
    where: {
      customerId,
      assignedDriverId: preferredDriverId,
      status: BookingStatus.COMPLETED,
      payment: { is: { status: { in: [PaymentStatus.CAPTURED, PaymentStatus.RECORDED] } } },
      rating: {
        is: {
          reviewerId: customerUserId,
          score: { gte: 4 }
        }
      }
    },
    select: { id: true }
  });

  if (!priorRatedTrip) {
    throw new AppError("That driver is no longer available as a repeat preference.", 403, "INVALID_PREFERRED_DRIVER");
  }
}

function isVerifiedCustomer(customer: any) {
  const primaryVehicle = customer.vehicles?.[0];

  return Boolean(
    customer.dateOfBirth &&
      customer.primaryAddress &&
      customer.emergencyContactName &&
      customer.emergencyContactPhone &&
      customer.identityDocument &&
      primaryVehicle?.make &&
      primaryVehicle?.model &&
      primaryVehicle?.plateNumber &&
      primaryVehicle?.registrationProvince &&
      customer.vehicleComplianceConfirmedAt &&
      customer.termsAcceptedAt &&
      customer.privacyPolicyAcceptedAt &&
      customer.identityVerificationConsentedAt &&
      customer.vehicleAuthorityConfirmedAt
  );
}

function toDriverBookingResponse(booking: any) {
  const primaryVehicle = booking.vehicle ?? booking.customer.vehicles?.[0] ?? null;

  return {
    id: booking.id,
    assignedDriverId: booking.assignedDriverId,
    requestType: booking.requestType,
    pickupLocation: booking.pickupLocation,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    destinationLocation: booking.destinationLocation,
    destinationLat: booking.destinationLat,
    destinationLng: booking.destinationLng,
    scheduledStartAt: booking.scheduledStartAt,
    expectedDurationMinutes: booking.expectedDurationMinutes,
    specialNotes: booking.specialNotes,
    status: booking.status,
    acceptedAt: booking.acceptedAt,
    completedAt: booking.completedAt,
    trip: booking.trip,
    paymentReady: booking.payment?.status === PaymentStatus.AUTHORIZED || isPaymentCaptured(booking.payment?.status),
    dispatches: booking.dispatches,
    customerSummary: {
      displayName: formatCustomerDisplayName(booking.customer.user.fullName),
      verified: isVerifiedCustomer(booking.customer),
      memberSince: booking.customer.createdAt,
      completedBookings: booking.customer._count.bookings,
      vehicle: primaryVehicle ? `${primaryVehicle.make} ${primaryVehicle.model}` : null
    }
  };
}

export function hasCompleteCustomerBookingProfile(user: any) {
  return incompleteCustomerBookingFields(user).length === 0;
}

export function incompleteCustomerBookingFields(user: any) {
  const vehicle = user.customerProfile?.vehicles[0];
  const hasCompleteVehicle = Boolean(vehicle?.make && vehicle?.model && vehicle?.plateNumber && vehicle?.registrationProvince);
  const missing: string[] = [];

  if (!user.emailVerifiedAt) missing.push("Verify your email");
  if (!user.phone) missing.push("Add a mobile phone number");
  if (!isEligibleCustomerAge(user.customerProfile?.dateOfBirth)) missing.push("Add an eligible date of birth");
  if (!user.customerProfile?.identityDocument) missing.push("Upload a government-issued photo ID");
  if (!hasCompleteVehicle) missing.push("Complete your vehicle details");

  return missing;
}

async function ensureCustomerCanBook(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      emailVerifiedAt: true,
      phone: true,
      customerProfile: {
        select: {
          dateOfBirth: true,
          identityDocument: { select: { id: true } },
          vehicles: {
            orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
            select: {
              make: true,
              model: true,
              plateNumber: true,
              registrationProvince: true
            },
            take: 1
          }
        }
      }
    }
  });
  const incompleteFields = incompleteCustomerBookingFields(user);
  if (incompleteFields.length > 0) {
    throw new AppError(
      `${incompleteFields.join(". ")}. Complete this before booking.`,
      403,
      "CUSTOMER_VERIFICATION_REQUIRED"
    );
  }
}

bookingsRoutes.post(
  "/bookings/estimate",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const input = estimateBookingSchema.parse(request.body);
    const activationWindow = buildActivationWindow(input.scheduledStartAt, input.expectedDurationMinutes);
    const pricing = await resolveBookingPricing({
      zoneCode: input.zoneCode,
      expectedDurationMinutes: input.expectedDurationMinutes,
      customerUserId: request.auth!.userId,
      pickupLocation: input.pickupLocation,
        destinationLocation: input.destinationLocation,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        deviceLat: input.deviceLat,
        deviceLng: input.deviceLng
      });
    const pricingRateLabel = pricing.membershipApplied ? "membership rate" : "rate";
    response.json({
      fareEstimate: pricing.fareEstimate,
      serviceFareEstimate: pricing.fareEstimate,
      carriedOverageAmount: 0,
      carriedOverageHours: 0,
      currency: "CAD",
      zoneCode: input.zoneCode,
      flatFeePerHour: pricing.flatFee,
      minHours: pricing.minHours,
      requestedHours: pricing.requestedHours,
      billableHours: pricing.billableHours,
      pricingProvince: pricing.province,
      pricingCity: pricing.city,
      pricingMembershipTier: pricing.membershipTier,
      membershipApplied: pricing.membershipApplied,
      baseFareEstimate: pricing.baseFareEstimate,
      membershipSavings: pricing.membershipSavings,
      activationWindowStartAt: activationWindow.startsAt.toISOString(),
      activationWindowEndAt: activationWindow.endsAt.toISOString(),
      pricingNote: `All rates are billed in CAD. ${pricing.billableHours} hour${pricing.billableHours === 1 ? "" : "s"} billed at $${pricing.flatFee}/hour ${pricingRateLabel}. No surge pricing is applied after booking confirmation.`
    });
  })
);

bookingsRoutes.post(
  "/bookings",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const input = createBookingSchema.parse(request.body);

    if (!validateBookingStartTime(input.requestType, input.scheduledStartAt)) {
      throw new AppError(
        input.requestType === "NOW"
          ? "Book Now requests must start in the future. Refresh your estimate and try again."
          : "Schedule later requests must start at least one hour from now.",
        400,
        "INVALID_BOOKING_START_TIME"
      );
    }

    await ensureCustomerCanBook(request.auth!.userId);

    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: { userId: request.auth!.userId }
    });

    await ensurePreferredDriverWasUsedBefore(customer.id, request.auth!.userId, input.preferredDriverId);

    const pricing = await resolveBookingPricing({
      zoneCode: input.zoneCode,
      expectedDurationMinutes: input.expectedDurationMinutes,
      customerUserId: request.auth!.userId,
      pickupLocation: input.pickupLocation,
        destinationLocation: input.destinationLocation,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        deviceLat: input.deviceLat,
        deviceLng: input.deviceLng
      });
    const existingBooking = await findMatchingAwaitingPaymentBooking({
      customerId: customer.id,
      ...input
    });

    const expectedFare = pricing.fareEstimate;
    if (existingBooking && Math.abs(Number(existingBooking.fareEstimate) - expectedFare) < 0.005) {
      response.json({
        booking: existingBooking,
        reusedPendingBooking: true
      });
      return;
    }

    const booking = await createBookingRecord({
      customerId: customer.id,
      customerUserId: request.auth!.userId,
      ...input
    });

    await notifyUser({
      userId: request.auth!.userId,
      type: "BOOKING_SUBMITTED",
      title: "Payment required",
      body: "Your booking has been created. Complete payment before driver matching can begin.",
      channel: "IN_APP",
      meta: {
        bookingId: booking.id,
        notifiedDrivers: 0,
        requestType: booking.requestType
      }
    });

    response.status(201).json({
      booking,
      notifiedDrivers: 0
    });
  })
);

bookingsRoutes.get(
  "/bookings/preferred-drivers",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const input = preferredDriversSchema.parse(request.query);
    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: { userId: request.auth!.userId }
    });
    const pastBookings = await prisma.booking.findMany({
      where: {
        customerId: customer.id,
        assignedDriverId: { not: null },
        status: BookingStatus.COMPLETED,
        payment: { is: { status: { in: [PaymentStatus.CAPTURED, PaymentStatus.RECORDED] } } },
        rating: {
          is: {
            reviewerId: request.auth!.userId,
            score: { gte: 4 }
          }
        }
      },
      select: {
        assignedDriverId: true,
        completedAt: true,
        rating: { select: { score: true } }
      },
      orderBy: { completedAt: "desc" }
    });

    const priorDriverRatings = new Map<string, { customerRating: number; completedTripsWithYou: number; lastTripAt: Date | null }>();
    for (const pastBooking of pastBookings) {
      if (!pastBooking.assignedDriverId || !pastBooking.rating) {
        continue;
      }
      const existing = priorDriverRatings.get(pastBooking.assignedDriverId);
      priorDriverRatings.set(pastBooking.assignedDriverId, {
        customerRating: existing?.customerRating ?? pastBooking.rating.score,
        completedTripsWithYou: (existing?.completedTripsWithYou ?? 0) + 1,
        lastTripAt: existing?.lastTripAt ?? pastBooking.completedAt
      });
    }

    if (!priorDriverRatings.size) {
      response.json([]);
      return;
    }

    const eligibleDrivers = await findEligibleDrivers(
      input.requestType,
      input.zoneCode,
      input.scheduledStartAt,
      input.expectedDurationMinutes,
      input.pickupLat,
      input.pickupLng,
      input.pickupLocation,
      100
    );
    const ratings = await prisma.rating.groupBy({
      by: ["reviewedUserId"],
      where: {
        reviewedUserId: { in: eligibleDrivers.map((driver) => driver.userId) }
      },
      _avg: { score: true },
      _count: { score: true }
    });
    const ratingByUserId = new Map(ratings.map((rating) => [rating.reviewedUserId, rating]));

    response.json(
      eligibleDrivers
        .filter((driver) => priorDriverRatings.has(driver.id))
        .map((driver) => {
          const history = priorDriverRatings.get(driver.id)!;
          const aggregate = ratingByUserId.get(driver.userId);
          return {
            id: driver.id,
            displayName: formatPreferredDriverName(driver.user.fullName),
            averageRating: aggregate?._avg.score ?? null,
            ratingCount: aggregate?._count.score ?? 0,
            customerRating: history.customerRating,
            completedTripsWithYou: history.completedTripsWithYou,
            lastTripAt: history.lastTripAt
          };
        })
    );
  })
);

bookingsRoutes.get(
  "/bookings",
  asyncHandler(async (request, response) => {
    if (request.auth!.role === "customer") {
      const customer = await prisma.customerProfile.findUniqueOrThrow({
        where: { userId: request.auth!.userId }
      });

      const bookings = await prisma.booking.findMany({
        where: {
          customerId: customer.id
        },
        include: {
          assignedDriver: {
            include: {
              user: true
            }
          },
          payment: true,
          rating: true,
          trip: true,
          dispatches: {
            include: {
              driver: {
                include: {
                  user: true
                }
              }
            },
            orderBy: [
              {
                distanceKm: "asc"
              },
              {
                notifiedAt: "desc"
              }
            ]
          }
        },
        orderBy: {
          scheduledStartAt: "desc"
        }
      });

      response.json(bookings);
      return;
    }

    if (request.auth!.role === "driver") {
      const driver = await prisma.driver.findUniqueOrThrow({
        where: { userId: request.auth!.userId }
      });

      const bookings = await prisma.booking.findMany({
        where: {
          OR: [
            { assignedDriverId: driver.id },
            {
              status: BookingStatus.PENDING,
              dispatches: {
                some: {
                  driverId: driver.id,
                  status: BookingDispatchStatus.PENDING
                }
              }
            }
          ]
        },
        include: {
          customer: {
            select: {
              createdAt: true,
              dateOfBirth: true,
              primaryAddress: true,
              emergencyContactName: true,
              emergencyContactPhone: true,
              vehicleComplianceConfirmedAt: true,
              termsAcceptedAt: true,
              privacyPolicyAcceptedAt: true,
              identityVerificationConsentedAt: true,
              vehicleAuthorityConfirmedAt: true,
              identityDocument: { select: { id: true } },
              user: { select: { fullName: true } },
              vehicles: {
                where: { isPrimary: true },
                select: { make: true, model: true, plateNumber: true, registrationProvince: true },
                take: 1
              },
              _count: {
                select: {
                  bookings: {
                    where: {
                      status: BookingStatus.COMPLETED,
                      payment: { is: { status: { in: [PaymentStatus.CAPTURED, PaymentStatus.RECORDED] } } }
                    }
                  }
                }
              }
            }
          },
          vehicle: { select: { make: true, model: true } },
          payment: { select: { status: true } },
          trip: { select: { id: true, status: true, arrivedAt: true, startedAt: true, endedAt: true } },
          dispatches: {
            where: {
              driverId: driver.id
            },
            orderBy: {
              notifiedAt: "desc"
            },
            take: 1
          }
        },
        orderBy: {
          scheduledStartAt: "asc"
        }
      });

      response.json(bookings.map(toDriverBookingResponse));
      return;
    }

    const bookings = await prisma.booking.findMany({
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
        },
        trip: true
      },
      orderBy: {
        scheduledStartAt: "desc"
      }
    });

    response.json(bookings);
  })
);

bookingsRoutes.get(
  "/bookings/:bookingId",
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const booking = await prisma.booking.findUniqueOrThrow({
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
        },
        trip: true,
        payment: true,
        rating: true
      }
    });

    response.json(booking);
  })
);

bookingsRoutes.post(
  "/bookings/:bookingId/accept",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { userId: request.auth!.userId }
    });

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true }
    });

    if (booking.status === BookingStatus.AWAITING_PAYMENT) {
      throw new AppError("This booking is still awaiting customer payment", 409, "PAYMENT_REQUIRED");
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new AppError("This booking is no longer available", 409, "BOOKING_UNAVAILABLE");
    }

    const dispatch = await prisma.bookingDispatch.findFirst({
      where: {
        bookingId: booking.id,
        driverId: driver.id,
        status: BookingDispatchStatus.PENDING
      }
    });

    if (!dispatch) {
      throw new AppError("This request is no longer routed to you", 403, "BOOKING_NOT_ROUTED");
    }

    const overlap = await driverHasOverlap(driver.id, booking.scheduledStartAt, booking.expectedDurationMinutes);
    if (overlap) {
      throw new AppError("This trip overlaps with another accepted assignment", 409, "OVERLAPPING_BOOKING");
    }

    if (!booking.payment) {
      throw new AppError("Payment authorization is missing", 409, "PAYMENT_NOT_AUTHORIZED");
    }

    // Stripe calls can take several seconds. Complete the idempotent capture
    // before opening the database transaction so a remote request never holds
    // the booking row lock or exhausts Prisma's transaction timeout.
    const capturedIntent = await captureAuthorizedBookingPayment(booking.payment);

    const updatedBooking = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${booking.id} FOR UPDATE`;
      const current = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: { payment: true }
      });
      if (current.status !== BookingStatus.PENDING || current.assignedDriverId) {
        throw new AppError("This booking is no longer available", 409, "BOOKING_UNAVAILABLE");
      }
      if (!current.payment) {
        throw new AppError("Payment authorization is missing", 409, "PAYMENT_NOT_AUTHORIZED");
      }
      if (!isPaymentCaptured(current.payment.status)) {
        if (
          !capturedIntent ||
          current.payment.status !== PaymentStatus.AUTHORIZED ||
          current.payment.stripePaymentIntentId !== capturedIntent.id
        ) {
          throw new AppError("Payment authorization is no longer capturable", 409, "PAYMENT_NOT_AUTHORIZED");
        }
        const now = new Date();
        await tx.payment.update({
          where: { id: current.payment.id },
          data: {
            status: PaymentStatus.CAPTURED,
            capturedAmount: (capturedIntent.amount_received ?? capturedIntent.amount) / 100,
            capturedAt: current.payment.capturedAt ?? now,
            recordedAt: current.payment.recordedAt ?? now,
            notes: "Stripe card authorization captured after driver acceptance."
          }
        });
      }
      const acceptedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          assignedDriverId: driver.id,
          status: BookingStatus.ACCEPTED,
          acceptedAt: new Date(),
          trip: {
            upsert: {
              create: {
                driverId: driver.id,
                status: "SCHEDULED"
              },
              update: {
                driverId: driver.id,
                status: "SCHEDULED"
              }
            }
          }
        },
        include: {
          assignedDriver: {
            include: {
              user: true
            }
          }
        }
      });

      await tx.bookingDispatch.updateMany({
        where: {
          bookingId: booking.id,
          status: BookingDispatchStatus.PENDING
        },
        data: {
          status: BookingDispatchStatus.EXPIRED,
          respondedAt: new Date()
        }
      });

      await tx.bookingDispatch.updateMany({
        where: {
          bookingId: booking.id,
          driverId: driver.id
        },
        data: {
          status: BookingDispatchStatus.ACCEPTED,
          respondedAt: new Date()
        }
      });

      return acceptedBooking;
    });

    const customerUserId = (
      await prisma.customerProfile.findUniqueOrThrow({
        where: { id: booking.customerId }
      })
    ).userId;

    await notifyUsers([
      {
        userId: customerUserId,
        type: "DRIVER_ACCEPTED",
        title: "Driver confirmed",
        body: `${updatedBooking.assignedDriver?.user.fullName} accepted your request.`,
        channel: "PUSH",
        meta: { bookingId: booking.id }
      },
      {
        userId: request.auth!.userId,
        type: "DRIVER_ACCEPTED",
        title: "Trip assigned",
        body: "The booking is now confirmed and will unlock at the trip window.",
        channel: "IN_APP",
        meta: { bookingId: booking.id }
      }
    ]);

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "BOOKING_ACCEPTED",
      entityType: "Booking",
      entityId: booking.id
    });

    response.json(updatedBooking);
  })
);

bookingsRoutes.post(
  "/bookings/:bookingId/reject",
  requireRole(["driver"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const driver = await prisma.driver.findUniqueOrThrow({
      where: { userId: request.auth!.userId }
    });

    const updated = await prisma.bookingDispatch.updateMany({
      where: {
        bookingId,
        driverId: driver.id,
        status: BookingDispatchStatus.PENDING
      },
      data: {
        status: BookingDispatchStatus.DECLINED,
        respondedAt: new Date()
      }
    });

    if (!updated.count) {
      throw new AppError("This request is no longer routed to you", 403, "BOOKING_NOT_ROUTED");
    }

    // Declines are internal dispatch events. Keep the customer in the matching
    // state and immediately move on to the next eligible driver when the
    // current dispatch batch has no pending offers left.
    await dispatchBookingToEligibleDrivers(bookingId);

    response.json({
      success: true,
      message: "Driver rejection acknowledged. The booking remains available to other eligible drivers."
    });
  })
);

bookingsRoutes.post(
  "/bookings/:bookingId/cancel",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const customer = await prisma.customerProfile.findUniqueOrThrow({
      where: { userId: request.auth!.userId }
    });

    await ensureCustomerCanCancel(bookingId, customer.id);

    const currentBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        trip: true,
        payment: true
      }
    });

    if (currentBooking.payment?.status === PaymentStatus.PENDING && currentBooking.payment.providerReference) {
      await expireStripeCheckoutSession(currentBooking.payment.providerReference);
    }

    const releasedIntent =
      currentBooking.payment?.status === PaymentStatus.AUTHORIZED && currentBooking.payment.stripePaymentIntentId
        ? await cancelStripePaymentIntent(
            currentBooking.payment.stripePaymentIntentId,
            `chaufx-booking-release-${currentBooking.payment.id}`
          )
        : null;

    const booking = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
      const locked = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payment: true, trip: true } });
      if (
        (locked.status !== BookingStatus.AWAITING_PAYMENT && locked.status !== BookingStatus.PENDING) ||
        locked.assignedDriverId ||
        isPaymentCaptured(locked.payment?.status)
      ) {
        throw new AppError(
          "This booking can no longer be cancelled in the app. Contact support if you need assistance.",
          409,
          "BOOKING_CANCELLATION_LOCKED"
        );
      }
      if (locked.payment?.status === PaymentStatus.AUTHORIZED && locked.payment.stripePaymentIntentId) {
        if (!releasedIntent || releasedIntent.id !== locked.payment.stripePaymentIntentId) {
          throw new AppError("The payment authorization changed while cancellation was processing.", 409, "PAYMENT_STATE_CHANGED");
        }
        if (releasedIntent.status === "succeeded") {
          throw new AppError("This booking was accepted while the cancellation was processing.", 409, "BOOKING_ALREADY_ACCEPTED");
        }
        await tx.payment.update({
          where: { id: locked.payment.id },
          data: {
            status: PaymentStatus.AUTHORIZATION_RELEASED,
            authorizationReleasedAt: new Date(),
            notes: "Stripe card authorization released after customer cancellation."
          }
        });
      }
      const cancelledBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          trip: locked.trip
            ? {
                update: {
                  status: "CANCELLED",
                  liveTrackingEnabled: false,
                  navigationEnabled: false
                }
              }
            : undefined
        }
      });

      await tx.bookingDispatch.updateMany({
        where: {
          bookingId,
          status: BookingDispatchStatus.PENDING
        },
        data: {
          status: BookingDispatchStatus.EXPIRED,
          respondedAt: new Date()
        }
      });

      if (locked.payment?.status === PaymentStatus.PENDING) {
        await tx.payment.update({
          where: { bookingId },
          data: {
            status: "FAILED",
            notes: "Payment cancelled by customer."
          }
        });
      }

      await tx.customerOverageCharge.updateMany({
        where: {
          appliedToBookingId: bookingId,
          status: "PENDING"
        },
        data: {
          appliedToBookingId: null
        }
      });

      return cancelledBooking;
    });

    response.json(booking);
  })
);

bookingsRoutes.post(
  "/bookings/:bookingId/assign-driver",
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      driverId: z.string().uuid()
    });
    const input = schema.parse(request.body);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { payment: true }
    });

    if (booking.status === BookingStatus.AWAITING_PAYMENT) {
      throw new AppError("This booking is still awaiting customer payment", 409, "PAYMENT_REQUIRED");
    }

    const overlap = await driverHasOverlap(input.driverId, booking.scheduledStartAt, booking.expectedDurationMinutes);
    if (overlap) {
      throw new AppError("Selected driver has an overlapping trip", 409, "OVERLAPPING_BOOKING");
    }

    if (!booking.payment) {
      throw new AppError("Payment authorization is missing", 409, "PAYMENT_NOT_AUTHORIZED");
    }

    // Keep Stripe outside the database transaction; the idempotency key makes
    // a retry safe if the booking changes before the row lock is acquired.
    const capturedIntent = await captureAuthorizedBookingPayment(booking.payment);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${booking.id} FOR UPDATE`;
      const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { payment: true } });
      if (current.status !== BookingStatus.PENDING || current.assignedDriverId) {
        throw new AppError("This booking is no longer available", 409, "BOOKING_UNAVAILABLE");
      }
      if (!current.payment) {
        throw new AppError("Payment authorization is missing", 409, "PAYMENT_NOT_AUTHORIZED");
      }
      if (!isPaymentCaptured(current.payment.status)) {
        if (
          !capturedIntent ||
          current.payment.status !== PaymentStatus.AUTHORIZED ||
          current.payment.stripePaymentIntentId !== capturedIntent.id
        ) {
          throw new AppError("Payment authorization is no longer capturable", 409, "PAYMENT_NOT_AUTHORIZED");
        }
        const now = new Date();
        await tx.payment.update({
          where: { id: current.payment.id },
          data: {
            status: PaymentStatus.CAPTURED,
            capturedAmount: (capturedIntent.amount_received ?? capturedIntent.amount) / 100,
            capturedAt: current.payment.capturedAt ?? now,
            recordedAt: current.payment.recordedAt ?? now,
            notes: "Stripe card authorization captured after admin driver assignment."
          }
        });
      }
      const assigned = await tx.booking.update({
        where: { id: booking.id },
        data: {
          assignedDriverId: input.driverId,
          status: BookingStatus.ACCEPTED,
          acceptedAt: new Date(),
          trip: {
            upsert: {
              create: {
                driverId: input.driverId,
                status: "SCHEDULED"
              },
              update: {
                driverId: input.driverId,
                status: "SCHEDULED"
              }
            }
          }
        }
      });

      await tx.bookingDispatch.updateMany({
        where: {
          bookingId: booking.id,
          status: BookingDispatchStatus.PENDING
        },
        data: {
          status: BookingDispatchStatus.EXPIRED,
          respondedAt: new Date()
        }
      });

      await tx.bookingDispatch.upsert({
        where: {
          bookingId_driverId: {
            bookingId: booking.id,
            driverId: input.driverId
          }
        },
        create: {
          bookingId: booking.id,
          driverId: input.driverId,
          status: BookingDispatchStatus.ACCEPTED,
          respondedAt: new Date()
        },
        update: {
          status: BookingDispatchStatus.ACCEPTED,
          respondedAt: new Date()
        }
      });

      return assigned;
    });

    response.json(updated);
  })
);

bookingsRoutes.post(
  "/bookings/:bookingId/rating",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const bookingId = paramValue(request.params.bookingId);
    const schema = z.object({
      score: z.coerce.number().int().min(1).max(5),
      comment: z.string().max(400).optional()
    });
    const input = schema.parse(request.body);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        customer: {
          include: {
            user: true
          }
        },
        payment: true,
        assignedDriver: {
          include: {
            user: true
          }
        }
      }
    });

    if (booking.customer.userId !== request.auth!.userId) {
      throw new AppError("You can only rate your own completed bookings", 403, "FORBIDDEN");
    }

    if (booking.status !== BookingStatus.COMPLETED || !booking.assignedDriverId) {
      throw new AppError("Ratings are only available after trip completion", 409, "TRIP_NOT_COMPLETED");
    }

    if (!isPaymentCaptured(booking.payment?.status)) {
      throw new AppError("Ratings are only available after a paid trip is completed", 409, "PAYMENT_REQUIRED");
    }

    const driver = await prisma.driver.findUniqueOrThrow({
      where: { id: booking.assignedDriverId }
    });

    const rating = await prisma.rating.upsert({
      where: {
        bookingId: booking.id
      },
      create: {
        bookingId: booking.id,
        reviewerId: request.auth!.userId,
        reviewedUserId: driver.userId,
        score: input.score,
        comment: input.comment
      },
      update: {
        score: input.score,
        comment: input.comment
      }
    });

    await notifyUsers([
      {
        userId: request.auth!.userId,
        type: "TRIP_COMPLETED",
        title: "Rating submitted",
        body: "Thanks for rating your driver.",
        channel: "IN_APP",
        meta: { bookingId: booking.id, score: rating.score }
      },
      {
        userId: driver.userId,
        type: "TRIP_COMPLETED",
        title: "New rider rating",
        body: `${booking.customer.user.fullName ?? "A customer"} rated your completed trip ${rating.score}/5.`,
        channel: "IN_APP",
        meta: { bookingId: booking.id, score: rating.score, comment: rating.comment ?? null }
      }
    ]);

    response.status(201).json(rating);
  })
);
