import { BookingDispatchStatus, BookingStatus } from "@prisma/client";
import { appConfig, buildActivationWindow, isTripWindowActive } from "../../lib/app-config.js";
import { AppError } from "../../common/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { notifyUser, notifyUsers } from "../../lib/notifications.js";

const provincePricingPrefix = "PROVINCE::";
const cityPricingPrefix = "CITY::";

const provinceMatchers: Array<{ province: string; patterns: RegExp[] }> = [
  { province: "Alberta", patterns: [/\balberta\b/i, /\bab\b/i] },
  { province: "British Columbia", patterns: [/\bbritish columbia\b/i, /\bbc\b/i] },
  { province: "Manitoba", patterns: [/\bmanitoba\b/i, /\bmb\b/i] },
  { province: "New Brunswick", patterns: [/\bnew brunswick\b/i, /\bnb\b/i] },
  { province: "Newfoundland and Labrador", patterns: [/\bnewfoundland and labrador\b/i, /\bnl\b/i] },
  { province: "Nova Scotia", patterns: [/\bnova scotia\b/i, /\bns\b/i] },
  { province: "Ontario", patterns: [/\bontario\b/i, /\bon\b/i] },
  { province: "Prince Edward Island", patterns: [/\bprince edward island\b/i, /\bpei\b/i, /\bpe\b/i] },
  { province: "Quebec", patterns: [/\bquebec\b/i, /\bqc\b/i, /\bqu\b/i] },
  { province: "Saskatchewan", patterns: [/\bsaskatchewan\b/i, /\bsk\b/i] },
  { province: "Northwest Territories", patterns: [/\bnorthwest territories\b/i, /\bnt\b/i] },
  { province: "Nunavut", patterns: [/\bnunavut\b/i, /\bnu\b/i] },
  { province: "Yukon", patterns: [/\byukon\b/i, /\byt\b/i] }
];

function decodePricingKeyPart(value: string) {
  return decodeURIComponent(value);
}

function inferServiceRegion(zoneCode: string, pickupLocation?: string, destinationLocation?: string) {
  const pickupParts = String(pickupLocation ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const destinationParts = String(destinationLocation ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const allParts = [...pickupParts, ...destinationParts];
  const combined = allParts.join(", ");

  for (const matcher of provinceMatchers) {
    const provinceIndex = allParts.findIndex((part) => matcher.patterns.some((pattern) => pattern.test(part)));
    if (provinceIndex >= 0) {
      const cityCandidate = allParts
        .slice(Math.max(0, provinceIndex - 1), provinceIndex)
        .reverse()
        .find((part) => /^[A-Za-z][A-Za-z .'-]+$/.test(part) && !matcher.patterns.some((pattern) => pattern.test(part)));

      return {
        province: matcher.province,
        city: cityCandidate ? cityCandidate.replace(/\s+/g, " ").trim() : undefined
      };
    }
  }

  if (/\bwinnipeg\b/i.test(combined) || zoneCode.startsWith("WPG-")) {
    return { province: "Manitoba", city: "Winnipeg" };
  }

  return { province: "Manitoba", city: undefined as string | undefined };
}

export async function resolveBookingPricing(params: {
  zoneCode: string;
  expectedDurationMinutes: number;
  pickupLocation?: string;
  destinationLocation?: string;
}) {
  const region = inferServiceRegion(params.zoneCode, params.pickupLocation, params.destinationLocation);
  const settings = await prisma.pricingSetting.findMany({
    where: {
      OR: [
        { code: { startsWith: provincePricingPrefix } },
        { code: { startsWith: cityPricingPrefix } }
      ]
    },
    select: {
      code: true,
      value: true
    }
  });

  let provinceFlatFee = 35;
  let provinceMinHours = 2;
  let cityFlatFee: number | null = null;
  let cityMinHours: number | null = null;

  for (const setting of settings) {
    if (setting.code.startsWith(provincePricingPrefix)) {
      const [, encodedProvince, kind] = setting.code.split("::");
      const province = decodePricingKeyPart(encodedProvince);

      if (province !== region.province) {
        continue;
      }

      if (kind === "FLAT_FEE") {
        provinceFlatFee = setting.value;
      }

      if (kind === "MIN_HOURS") {
        provinceMinHours = setting.value;
      }
    }

    if (region.city && setting.code.startsWith(cityPricingPrefix)) {
      const [, encodedProvince, encodedCity, kind] = setting.code.split("::");
      const province = decodePricingKeyPart(encodedProvince);
      const city = decodePricingKeyPart(encodedCity);

      if (province !== region.province || city.toLowerCase() !== region.city.toLowerCase()) {
        continue;
      }

      if (kind === "FLAT_FEE") {
        cityFlatFee = setting.value;
      }

      if (kind === "MIN_HOURS") {
        cityMinHours = setting.value;
      }
    }
  }

  const flatFee = cityFlatFee ?? provinceFlatFee;
  const minHours = cityMinHours ?? provinceMinHours;
  const requestedHours = Math.max(1, Math.ceil(params.expectedDurationMinutes / 60));
  const billableHours = Math.max(requestedHours, minHours);
  const fareEstimate = Number((flatFee * billableHours).toFixed(2));

  return {
    province: region.province,
    city: region.city,
    flatFee,
    minHours,
    requestedHours,
    billableHours,
    fareEstimate
  };
}

export function windowsOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

export function haversineDistanceKm(startLat: number, startLng: number, endLat: number, endLng: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(endLat - startLat);
  const deltaLng = toRadians(endLng - startLng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(startLat)) * Math.cos(toRadians(endLat)) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return Number((earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

export async function driverHasOverlap(driverId: string, scheduledStartAt: Date, expectedDurationMinutes: number) {
  const nextWindow = buildActivationWindow(scheduledStartAt, expectedDurationMinutes);
  const bookings = await prisma.booking.findMany({
    where: {
      assignedDriverId: driverId,
      status: {
        in: [BookingStatus.ACCEPTED, BookingStatus.ENROUTE, BookingStatus.ACTIVE]
      }
    },
    select: {
      activationWindowStartAt: true,
      activationWindowEndAt: true
    }
  });

  return bookings.some((booking: { activationWindowStartAt: Date; activationWindowEndAt: Date }) =>
    windowsOverlap(
      nextWindow.startsAt,
      nextWindow.endsAt,
      booking.activationWindowStartAt,
      booking.activationWindowEndAt
    )
  );
}

export async function findEligibleDrivers(
  zoneCode: string,
  scheduledStartAt: Date,
  expectedDurationMinutes: number,
  pickupLat: number,
  pickupLng: number
) {
  const freshnessThreshold = new Date(Date.now() - appConfig.driverLocationFreshnessMinutes * 60_000);
  const drivers = await prisma.driver.findMany({
    where: {
      approvedAt: {
        not: null
      },
      availabilityStatus: true,
      currentLatitude: {
        not: null
      },
      currentLongitude: {
        not: null
      },
      locationUpdatedAt: {
        gte: freshnessThreshold
      },
      serviceAreas: {
        has: zoneCode
      }
    },
    include: {
      user: true
    }
  });

  const eligible: Array<(typeof drivers)[number] & { distanceKm: number }> = [];

  for (const driver of drivers) {
    const overlap = await driverHasOverlap(driver.id, scheduledStartAt, expectedDurationMinutes);
    if (!overlap) {
      eligible.push({
        ...driver,
        distanceKm: haversineDistanceKm(pickupLat, pickupLng, Number(driver.currentLatitude), Number(driver.currentLongitude))
      });
    }
  }

  return eligible.sort((left, right) => left.distanceKm - right.distanceKm).slice(0, appConfig.driverDispatchFanout);
}

export function mapStateForBooking(booking: {
  id: string;
  status: BookingStatus;
  activationWindowStartAt: Date;
  activationWindowEndAt: Date;
}) {
  const activeStatuses: BookingStatus[] = [BookingStatus.ACCEPTED, BookingStatus.ENROUTE, BookingStatus.ACTIVE];
  const activeWindow = isTripWindowActive(new Date(), booking.activationWindowStartAt, booking.activationWindowEndAt);
  const active = activeStatuses.includes(booking.status) && activeWindow;

  return {
    bookingId: booking.id,
    active,
    canNavigate: active,
    activationStartsAt: booking.activationWindowStartAt.toISOString(),
    activationEndsAt: booking.activationWindowEndAt.toISOString(),
    reason: active ? undefined : "Trip map stays locked until the accepted booking enters its active window."
  };
}

export async function createBookingRecord(input: {
  customerId: string;
  vehicleId?: string;
  requestType: "NOW" | "LATER";
  pickupLocation: string;
  pickupLat: number;
  pickupLng: number;
  destinationLocation: string;
  destinationLat: number;
  destinationLng: number;
  scheduledStartAt: Date;
  expectedDurationMinutes: number;
  specialNotes?: string;
  vehicleDetails?: string;
  zoneCode: string;
}) {
  const activationWindow = buildActivationWindow(input.scheduledStartAt, input.expectedDurationMinutes);
  const pricing = await resolveBookingPricing({
    zoneCode: input.zoneCode,
    expectedDurationMinutes: input.expectedDurationMinutes,
    pickupLocation: input.pickupLocation,
    destinationLocation: input.destinationLocation
  });

  const booking = await prisma.booking.create({
    data: {
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      requestType: input.requestType,
      pickupLocation: input.pickupLocation,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      destinationLocation: input.destinationLocation,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      scheduledStartAt: input.scheduledStartAt,
      expectedDurationMinutes: input.expectedDurationMinutes,
      specialNotes: input.specialNotes,
      vehicleDetails: input.vehicleDetails,
      zoneCode: input.zoneCode,
      fareEstimate: pricing.fareEstimate,
      activationWindowStartAt: activationWindow.startsAt,
      activationWindowEndAt: activationWindow.endsAt
    }
  });

  return booking;
}

export async function dispatchBookingToEligibleDrivers(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: {
        include: {
          user: true
        }
      },
      payment: true,
      dispatches: {
        where: {
          status: {
            in: [BookingDispatchStatus.PENDING, BookingDispatchStatus.ACCEPTED]
          }
        },
        select: {
          id: true
        }
      }
    }
  });

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (
    (booking.status !== BookingStatus.AWAITING_PAYMENT && booking.status !== BookingStatus.PENDING) ||
    booking.assignedDriverId
  ) {
    return { booking, notifiedDrivers: 0, skipped: true as const };
  }

  if (!booking.payment || booking.payment.status !== "RECORDED") {
    return { booking, notifiedDrivers: 0, skipped: true as const };
  }

  if (booking.dispatches.length > 0) {
    return { booking, notifiedDrivers: booking.dispatches.length, skipped: true as const };
  }

  if (booking.status === BookingStatus.AWAITING_PAYMENT) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.PENDING
      }
    });
    booking.status = BookingStatus.PENDING;
  }

  const drivers = await findEligibleDrivers(
    booking.zoneCode,
    booking.scheduledStartAt,
    booking.expectedDurationMinutes,
    Number(booking.pickupLat),
    Number(booking.pickupLng)
  );

  if (drivers.length) {
    await prisma.bookingDispatch.createMany({
      data: drivers.map((driver) => ({
        bookingId: booking.id,
        driverId: driver.id,
        distanceKm: driver.distanceKm,
        status: BookingDispatchStatus.PENDING
      }))
    });

    await notifyUsers(
      drivers.map((driver) => ({
        userId: driver.userId,
        type: "BOOKING_SUBMITTED" as const,
        title: booking.requestType === "NOW" ? "ChaufX now request" : "Scheduled drive request",
        body:
          booking.requestType === "NOW"
            ? `${booking.pickupLocation} to ${booking.destinationLocation} · starting soon`
            : `${booking.pickupLocation} to ${booking.destinationLocation} · ${booking.scheduledStartAt.toLocaleString()}`,
        channel: "PUSH" as const,
        meta: {
          bookingId: booking.id,
          distanceKm: driver.distanceKm,
          requestType: booking.requestType
        }
      }))
    );
  }

  await notifyUser({
    userId: booking.customer.userId,
    type: "BOOKING_SUBMITTED",
    title: drivers.length ? "Driver matching started" : "Payment recorded",
    body: drivers.length
      ? booking.requestType === "NOW"
        ? "Payment received. We are now routing your ChaufX now request to the nearest eligible drivers."
        : "Payment received. We are now routing your scheduled drive to the nearest eligible drivers."
      : "Payment received. We could not find an eligible driver yet, but we will keep checking nearby availability.",
    channel: "IN_APP",
    meta: {
      bookingId: booking.id,
      notifiedDrivers: drivers.length,
      requestType: booking.requestType
    }
  });

  return { booking, notifiedDrivers: drivers.length, skipped: false as const };
}

export async function ensureCustomerCanCancel(bookingId: string, customerId: string) {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      customerId
    }
  });

  if (!booking) {
    throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.status === BookingStatus.ACTIVE || booking.status === BookingStatus.ENROUTE) {
    throw new AppError("Trips cannot be cancelled after they start", 409, "TRIP_ALREADY_STARTED");
  }

  return booking;
}
