import { BookingDispatchStatus, BookingStatus } from "@prisma/client";
import { appConfig, buildActivationWindow, isTripWindowActive } from "../../lib/app-config.js";
import { AppError } from "../../common/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { notifyUser, notifyUsers } from "../../lib/notifications.js";
import { getActiveMembershipHourlyRate } from "../memberships/membership.service.js";

const provincePricingPrefix = "PROVINCE::";
const cityPricingPrefix = "CITY::";
const fallbackPricingPrefix = "FALLBACK::";
const fallbackPricingLabel = "Outside configured region";

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

type ServiceRegion = {
  province: string;
  city?: string;
  isFallback?: boolean;
};

type CoordinateRegion = {
  province: string;
  city?: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
};

const coordinateRegions: CoordinateRegion[] = [
  {
    province: "Manitoba",
    city: "Winnipeg",
    bounds: { minLat: 49.6, maxLat: 50.1, minLng: -97.45, maxLng: -96.95 }
  },
  {
    province: "Alberta",
    bounds: { minLat: 48.9, maxLat: 60.1, minLng: -120.1, maxLng: -109.9 }
  },
  {
    province: "British Columbia",
    bounds: { minLat: 48.2, maxLat: 60.1, minLng: -139.1, maxLng: -114.0 }
  },
  {
    province: "Saskatchewan",
    bounds: { minLat: 49.0, maxLat: 60.1, minLng: -110.1, maxLng: -101.2 }
  },
  {
    province: "Manitoba",
    bounds: { minLat: 48.9, maxLat: 60.1, minLng: -102.1, maxLng: -88.8 }
  },
  {
    province: "Ontario",
    bounds: { minLat: 41.5, maxLat: 56.9, minLng: -95.3, maxLng: -74.0 }
  },
  {
    province: "Quebec",
    bounds: { minLat: 45.0, maxLat: 62.0, minLng: -79.9, maxLng: -57.0 }
  },
  {
    province: "New Brunswick",
    bounds: { minLat: 44.5, maxLat: 48.2, minLng: -69.2, maxLng: -63.8 }
  },
  {
    province: "Nova Scotia",
    bounds: { minLat: 43.3, maxLat: 47.1, minLng: -66.6, maxLng: -59.5 }
  },
  {
    province: "Prince Edward Island",
    bounds: { minLat: 45.9, maxLat: 47.2, minLng: -64.6, maxLng: -61.8 }
  },
  {
    province: "Newfoundland and Labrador",
    bounds: { minLat: 46.5, maxLat: 60.8, minLng: -67.9, maxLng: -52.5 }
  },
  {
    province: "Yukon",
    bounds: { minLat: 59.9, maxLat: 69.8, minLng: -141.1, maxLng: -123.7 }
  },
  {
    province: "Northwest Territories",
    bounds: { minLat: 59.8, maxLat: 78.9, minLng: -136.6, maxLng: -102.0 }
  },
  {
    province: "Nunavut",
    bounds: { minLat: 51.2, maxLat: 83.2, minLng: -120.0, maxLng: -60.0 }
  }
];

function decodePricingKeyPart(value: string) {
  return decodeURIComponent(value);
}

function findCanadianRegion(parts: string[]): ServiceRegion | null {
  for (const matcher of provinceMatchers) {
    const provinceIndex = parts.findIndex((part) => matcher.patterns.some((pattern) => pattern.test(part)));
    if (provinceIndex >= 0) {
      const cityCandidate = parts
        .slice(Math.max(0, provinceIndex - 1), provinceIndex)
        .reverse()
        .find((part) => /^[A-Za-z][A-Za-z .'-]+$/.test(part) && !matcher.patterns.some((pattern) => pattern.test(part)));

      return {
        province: matcher.province,
        city: cityCandidate ? cityCandidate.replace(/\s+/g, " ").trim() : undefined
      };
    }
  }

  return null;
}

export function findCanadianRegionByCoordinate(latitude?: number, longitude?: number): ServiceRegion | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  for (const region of coordinateRegions) {
    const { minLat, maxLat, minLng, maxLng } = region.bounds;
    if (latitude! >= minLat && latitude! <= maxLat && longitude! >= minLng && longitude! <= maxLng) {
      return {
        province: region.province,
        city: region.city
      };
    }
  }

  return null;
}

export function inferServiceRegion(
  zoneCode: string,
  pickupLocation?: string,
  destinationLocation?: string,
  pickupLat?: number,
  pickupLng?: number
): ServiceRegion {
  const pickupParts = String(pickupLocation ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const destinationParts = String(destinationLocation ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const pickupRegion = findCanadianRegion(pickupParts);
  if (pickupRegion) {
    return pickupRegion;
  }

  const destinationRegion = findCanadianRegion(destinationParts);
  if (!pickupParts.length && destinationRegion) {
    return destinationRegion;
  }

  const coordinateRegion = findCanadianRegionByCoordinate(pickupLat, pickupLng);
  if (coordinateRegion) {
    return coordinateRegion;
  }

  const pickupCombined = pickupParts.join(", ");
  if (/\bwinnipeg\b/i.test(pickupCombined) || (!pickupCombined && zoneCode.startsWith("WPG-"))) {
    return { province: "Manitoba", city: "Winnipeg" };
  }

  return { province: fallbackPricingLabel, city: undefined as string | undefined, isFallback: true };
}

export async function resolveBookingPricing(params: {
  zoneCode: string;
  expectedDurationMinutes: number;
  customerUserId?: string;
  pickupLocation?: string;
  destinationLocation?: string;
  pickupLat?: number;
  pickupLng?: number;
}) {
  const region = inferServiceRegion(
    params.zoneCode,
    params.pickupLocation,
    params.destinationLocation,
    params.pickupLat,
    params.pickupLng
  );
  const settings = await prisma.pricingSetting.findMany({
    where: {
      OR: [
        { code: { startsWith: provincePricingPrefix } },
        { code: { startsWith: cityPricingPrefix } },
        { code: { startsWith: fallbackPricingPrefix } }
      ]
    },
    select: {
      code: true,
      value: true
    }
  });

  let provinceFlatFee = 35;
  let provinceMinHours = 2;
  let fallbackFlatFee = 35;
  let fallbackMinHours = 2;
  let cityFlatFee: number | null = null;
  let cityMinHours: number | null = null;

  for (const setting of settings) {
    if (setting.code.startsWith(fallbackPricingPrefix)) {
      const [, kind] = setting.code.split("::");

      if (kind === "FLAT_FEE") {
        fallbackFlatFee = setting.value;
      }

      if (kind === "MIN_HOURS") {
        fallbackMinHours = setting.value;
      }
    }

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

  const regionalFlatFee = region.isFallback ? fallbackFlatFee : cityFlatFee ?? provinceFlatFee;
  const minHours = region.isFallback ? fallbackMinHours : cityMinHours ?? provinceMinHours;
  let membershipFlatFee: number | null = null;
  let membershipTier: string | null = null;

  if (params.customerUserId) {
    const customerUser = await prisma.user.findUnique({
      where: { id: params.customerUserId },
      select: {
        membershipTier: true,
        membershipStatus: true,
        membershipHourlyRate: true
      }
    });

    if (customerUser) {
      membershipTier = customerUser.membershipTier;
      membershipFlatFee = getActiveMembershipHourlyRate(customerUser);
    }
  }

  const flatFee = membershipFlatFee ?? regionalFlatFee;
  const requestedHours = Math.max(1, Math.ceil(params.expectedDurationMinutes / 60));
  const billableHours = Math.max(requestedHours, minHours);
  const fareEstimate = Number((flatFee * billableHours).toFixed(2));

  return {
    province: region.province,
    city: region.city,
    flatFee,
    baseFlatFee: regionalFlatFee,
    membershipTier,
    membershipApplied: membershipFlatFee !== null,
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

function normalizeServiceArea(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

const realtimeDispatchFreshnessMinutes = 5;
const realtimeDispatchRadiusKm = 25;

function driverMatchesServiceArea(
  serviceAreas: string[],
  zoneCode: string,
  pickupLocation: string,
  pickupLat: number,
  pickupLng: number
) {
  const region = inferServiceRegion(zoneCode, pickupLocation, undefined, pickupLat, pickupLng);
  const normalizedAreas = serviceAreas.map((value) => normalizeServiceArea(value)).filter(Boolean);
  const zone = normalizeServiceArea(zoneCode);
  const province = normalizeServiceArea(region.province);
  const city = normalizeServiceArea(region.city);

  if (!normalizedAreas.length) {
    return false;
  }

  return normalizedAreas.some((area) => {
    if (area === "canada" || area === "all" || area === "nationwide") {
      return true;
    }

    if (area === zone || area === province || (city && area === city)) {
      return true;
    }

    if (city && (area === `${province}:${city}` || area === `${city}, ${province}`)) {
      return true;
    }

    if (province && area.includes(province)) {
      return true;
    }

    if (city && area.includes(city)) {
      return true;
    }

    return false;
  });
}

export async function findEligibleDrivers(
  requestType: "NOW" | "LATER",
  zoneCode: string,
  scheduledStartAt: Date,
  expectedDurationMinutes: number,
  pickupLat: number,
  pickupLng: number,
  pickupLocation: string
) {
  const freshnessMinutes = requestType === "NOW" ? realtimeDispatchFreshnessMinutes : appConfig.driverLocationFreshnessMinutes;
  const freshnessThreshold = new Date(Date.now() - freshnessMinutes * 60_000);
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
      }
    },
    include: {
      user: true
    }
  });

  const eligible: Array<(typeof drivers)[number] & { distanceKm: number; matchesServiceArea: boolean }> = [];

  for (const driver of drivers) {
    const overlap = await driverHasOverlap(driver.id, scheduledStartAt, expectedDurationMinutes);
    if (overlap) {
      continue;
    }

    const distanceKm = haversineDistanceKm(pickupLat, pickupLng, Number(driver.currentLatitude), Number(driver.currentLongitude));
    const matchesServiceArea = driverMatchesServiceArea(driver.serviceAreas, zoneCode, pickupLocation, pickupLat, pickupLng);

    if (requestType === "NOW" && distanceKm > realtimeDispatchRadiusKm) {
      continue;
    }

    eligible.push({
      ...driver,
      distanceKm,
      matchesServiceArea
    });
  }

  return eligible
    .sort((left, right) => {
      if (requestType !== "NOW" && left.matchesServiceArea !== right.matchesServiceArea) {
        return left.matchesServiceArea ? -1 : 1;
      }

      return left.distanceKm - right.distanceKm;
    })
    .slice(0, appConfig.driverDispatchFanout);
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
  customerUserId: string;
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
    customerUserId: input.customerUserId,
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
    booking.requestType,
    booking.zoneCode,
    booking.scheduledStartAt,
    booking.expectedDurationMinutes,
    Number(booking.pickupLat),
    Number(booking.pickupLng),
    booking.pickupLocation
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
