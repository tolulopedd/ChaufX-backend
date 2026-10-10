import { BookingDispatchStatus, BookingStatus, MembershipTier, PaymentStatus } from "@prisma/client";
import { appConfig, buildActivationWindow, isTripWindowActive } from "../../lib/app-config.js";
import { AppError } from "../../common/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { notifyUser, notifyUsers } from "../../lib/notifications.js";
import { isPaymentAuthorizedForDispatch } from "../payments/payment-status.js";
import { getActiveMembershipHourlyRate } from "../memberships/membership.service.js";
import { env } from "../../config/env.js";
import { getFirstRidePromotionQuote, reserveFirstRidePromotion } from "../promotions/first-ride-promotion.service.js";

const provincePricingPrefix = "PROVINCE::";
const cityPricingPrefix = "CITY::";
const fallbackPricingPrefix = "FALLBACK::";
const fallbackPricingLabel = "Outside configured region";
const bookNowMatchingWindowMs = 60 * 60_000;
const scheduledMatchingLeadTimeMs = 2 * 60 * 60_000;

/** The latest point at which an unaccepted authorized booking may remain open. */
export function unacceptedBookingExpiresAt(input: {
  requestType: "NOW" | "LATER";
  scheduledStartAt: Date;
  authorizedAt: Date | null;
  createdAt: Date;
}) {
  const matchingStartedAt = input.authorizedAt ?? input.createdAt;
  const matchingWindowMs = input.requestType === "NOW" ? bookNowMatchingWindowMs : scheduledMatchingLeadTimeMs;
  const matchingDeadline = new Date(matchingStartedAt.getTime() + matchingWindowMs);
  return input.requestType === "LATER" && input.scheduledStartAt < matchingDeadline
    ? input.scheduledStartAt
    : matchingDeadline;
}

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
  pickupLng?: number,
  deviceLat?: number,
  deviceLng?: number,
  profileAddress?: string
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

  // A selected pickup describes where the service is needed, so it wins over
  // the device's current location (customers may book for another province).
  const pickupCoordinateRegion = findCanadianRegionByCoordinate(pickupLat, pickupLng);
  if (pickupCoordinateRegion) return pickupCoordinateRegion;

  const deviceRegion = findCanadianRegionByCoordinate(deviceLat, deviceLng);
  if (deviceRegion) return deviceRegion;

  const profileRegion = findCanadianRegion(
    String(profileAddress ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
  if (profileRegion) return profileRegion;

  const destinationRegion = findCanadianRegion(destinationParts);
  if (!pickupParts.length && destinationRegion) {
    return destinationRegion;
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
  deviceLat?: number;
  deviceLng?: number;
}) {
  const customerUser = params.customerUserId
    ? await prisma.user.findUnique({
        where: { id: params.customerUserId },
        select: {
          membershipTier: true,
          membershipStatus: true,
          membershipHourlyRate: true,
          customerProfile: { select: { primaryAddress: true } }
        }
      })
    : null;
  const region = inferServiceRegion(
    params.zoneCode,
    params.pickupLocation,
    params.destinationLocation,
    params.pickupLat,
    params.pickupLng,
    params.deviceLat,
    params.deviceLng,
    customerUser?.customerProfile?.primaryAddress ?? undefined
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
  let provinceFlatFeeConfigured = false;
  let provinceMinHoursConfigured = false;
  let fallbackFlatFeeConfigured = false;
  let fallbackMinHoursConfigured = false;
  let cityFlatFeeConfigured = false;
  let cityMinHoursConfigured = false;

  for (const setting of settings) {
    if (setting.code.startsWith(fallbackPricingPrefix)) {
      const [, kind] = setting.code.split("::");

      if (kind === "FLAT_FEE") {
        fallbackFlatFee = setting.value;
        fallbackFlatFeeConfigured = true;
      }

      if (kind === "MIN_HOURS") {
        fallbackMinHours = setting.value;
        fallbackMinHoursConfigured = true;
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
        provinceFlatFeeConfigured = true;
      }

      if (kind === "MIN_HOURS") {
        provinceMinHours = setting.value;
        provinceMinHoursConfigured = true;
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
        cityFlatFeeConfigured = true;
      }

      if (kind === "MIN_HOURS") {
        cityMinHours = setting.value;
        cityMinHoursConfigured = true;
      }
    }
  }

  const cityPricingConfigured = cityFlatFeeConfigured && cityMinHoursConfigured;
  const pricingAvailable = region.isFallback
    ? fallbackFlatFeeConfigured && fallbackMinHoursConfigured
    : provinceFlatFeeConfigured && provinceMinHoursConfigured;
  const regionalFlatFee = region.isFallback ? fallbackFlatFee : cityPricingConfigured ? cityFlatFee! : provinceFlatFee;
  const minHours = region.isFallback ? fallbackMinHours : cityPricingConfigured ? cityMinHours! : provinceMinHours;
  let membershipFlatFee: number | null = null;
  let membershipTier: MembershipTier | null = null;

  if (customerUser) {
    membershipTier = customerUser.membershipTier;
    membershipFlatFee = await getActiveMembershipHourlyRate(customerUser);
  }

  const flatFee = membershipFlatFee ?? regionalFlatFee;
  const requestedHours = Math.max(1, Math.ceil(params.expectedDurationMinutes / 60));
  const billableHours = Math.max(requestedHours, minHours);
  const baseFareEstimate = Number((regionalFlatFee * billableHours).toFixed(2));
  const membershipFareEstimate = Number((flatFee * billableHours).toFixed(2));
  const membershipSavings = membershipFlatFee !== null ? Number(Math.max(0, baseFareEstimate - membershipFareEstimate).toFixed(2)) : 0;
  const firstRidePromotion = params.customerUserId && membershipTier
    ? await getFirstRidePromotionQuote({
        customerUserId: params.customerUserId,
        fare: membershipFareEstimate,
        membershipTier,
        membershipApplied: membershipFlatFee !== null
      })
    : { eligible: false, originalFare: membershipFareEstimate, discountAmount: 0, discountedFare: membershipFareEstimate };
  const fareEstimate = firstRidePromotion.discountedFare;

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
    fareEstimate,
    baseFareEstimate,
    membershipSavings,
    firstRidePromotion,
    pricingAvailable,
    pricingUnavailableMessage: pricingAvailable
      ? undefined
      : `Pricing is not configured for ${region.isFallback ? "this pickup location" : region.province}.`
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

const realtimeDispatchFreshnessMinutes = env.DRIVER_REALTIME_LOCATION_FRESHNESS_MINUTES;

export function bookingDispatchExpiresAt(from = new Date()) {
  return new Date(from.getTime() + env.BOOKING_REQUEST_TIMEOUT_SECONDS * 1000);
}

export async function expireTimedOutDispatches(bookingId?: string) {
  const now = new Date();
  const legacyDeadline = new Date(now.getTime() - env.BOOKING_REQUEST_TIMEOUT_SECONDS * 1000);
  const result = await prisma.bookingDispatch.updateMany({
    where: {
      ...(bookingId ? { bookingId } : {}),
      status: BookingDispatchStatus.PENDING,
      OR: [{ expiresAt: { lte: now } }, { expiresAt: null, notifiedAt: { lte: legacyDeadline } }]
    },
    data: { status: BookingDispatchStatus.EXPIRED, respondedAt: now }
  });
  if (result.count) {
    console.info("booking_dispatch_expired", JSON.stringify({ bookingId: bookingId ?? null, count: result.count }));
  }
  return result.count;
}

export function isDriverReachable(lastHeartbeatAt: Date | null, activePushDeviceCount: number, now = new Date()) {
  const heartbeatThreshold = now.getTime() - env.DRIVER_REACHABILITY_GRACE_SECONDS * 1000;
  return activePushDeviceCount > 0 || Boolean(lastHeartbeatAt && lastHeartbeatAt.getTime() >= heartbeatThreshold);
}
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
  pickupLocation: string,
  maxDrivers: number = appConfig.driverDispatchFanout
) {
  const freshnessMinutes = requestType === "NOW"
    ? realtimeDispatchFreshnessMinutes
    : Math.max(appConfig.driverLocationFreshnessMinutes, env.DRIVER_REALTIME_LOCATION_FRESHNESS_MINUTES);
  const freshnessThreshold = new Date(Date.now() - freshnessMinutes * 60_000);
  const pushThreshold = new Date(Date.now() - env.DRIVER_PUSH_REACHABILITY_DAYS * 24 * 60 * 60_000);
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
      user: {
        include: {
          pushDevices: {
            where: { appVariant: "driver", disabledAt: null, lastSeenAt: { gte: pushThreshold } },
            select: { id: true }
          }
        }
      }
    }
  });

  const eligible: Array<(typeof drivers)[number] & { distanceKm: number; matchesServiceArea: boolean }> = [];

  for (const driver of drivers) {
    const reachable = isDriverReachable(driver.lastHeartbeatAt, driver.user.pushDevices.length);
    if (!reachable) continue;
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
    .slice(0, maxDrivers);
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
  preferredDriverId?: string;
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
  deviceLat?: number;
  deviceLng?: number;
}) {
  const activationWindow = buildActivationWindow(input.scheduledStartAt, input.expectedDurationMinutes);
  const pricing = await resolveBookingPricing({
    zoneCode: input.zoneCode,
    expectedDurationMinutes: input.expectedDurationMinutes,
    customerUserId: input.customerUserId,
    pickupLocation: input.pickupLocation,
    destinationLocation: input.destinationLocation,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    deviceLat: input.deviceLat,
    deviceLng: input.deviceLng
  });
  if (!pricing.pricingAvailable) {
    throw new AppError(pricing.pricingUnavailableMessage ?? "Pricing is unavailable for this pickup location.", 409, "PRICING_UNAVAILABLE");
  }

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        preferredDriverId: input.preferredDriverId,
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
        // Reserve the discount in this transaction before exposing the booking.
        // If another request wins the single first-ride reservation, the booking
        // falls back to the already-calculated membership/standard fare.
        fareEstimate: pricing.firstRidePromotion.originalFare,
        bookedHourlyRate: pricing.flatFee,
        activationWindowStartAt: activationWindow.startsAt,
        activationWindowEndAt: activationWindow.endsAt
      }
    });

    const promotion = await reserveFirstRidePromotion(tx, {
      bookingId: created.id,
      customerId: input.customerId,
      membershipTier: pricing.membershipTier ?? MembershipTier.BASIC,
      membershipApplied: pricing.membershipApplied,
      fare: pricing.firstRidePromotion.originalFare
    });
    if (!promotion.eligible) return created;
    return tx.booking.update({
      where: { id: created.id },
      data: {
        fareEstimate: promotion.discountedFare,
        promotionOriginalFare: promotion.originalFare,
        promotionDiscountAmount: promotion.discountAmount
      }
    });
  });

  return booking;
}

function normalizeBookingText(value?: string | null) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export async function findMatchingAwaitingPaymentBooking(input: {
  customerId: string;
  vehicleId?: string;
  preferredDriverId?: string;
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
  const candidates = await prisma.booking.findMany({
    where: {
      customerId: input.customerId,
      vehicleId: input.vehicleId ?? null,
      requestType: input.requestType,
      scheduledStartAt: input.scheduledStartAt,
      expectedDurationMinutes: input.expectedDurationMinutes,
      status: BookingStatus.AWAITING_PAYMENT
    },
    include: {
      payment: true
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  return candidates.find((booking) => {
    const paymentCanContinue = !booking.payment || booking.payment.status === PaymentStatus.PENDING;

    return (
      paymentCanContinue &&
      normalizeBookingText(booking.pickupLocation) === normalizeBookingText(input.pickupLocation) &&
      normalizeBookingText(booking.destinationLocation) === normalizeBookingText(input.destinationLocation) &&
      Math.abs(Number(booking.pickupLat) - input.pickupLat) < 0.00001 &&
      Math.abs(Number(booking.pickupLng) - input.pickupLng) < 0.00001 &&
      Math.abs(Number(booking.destinationLat) - input.destinationLat) < 0.00001 &&
      Math.abs(Number(booking.destinationLng) - input.destinationLng) < 0.00001 &&
      normalizeBookingText(booking.specialNotes) === normalizeBookingText(input.specialNotes) &&
      normalizeBookingText(booking.vehicleDetails) === normalizeBookingText(input.vehicleDetails) &&
      booking.zoneCode === input.zoneCode &&
      booking.preferredDriverId === (input.preferredDriverId ?? null)
    );
  });
}

export async function dispatchBookingToEligibleDrivers(bookingId: string) {
  await expireTimedOutDispatches(bookingId);
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
        select: {
          id: true,
          driverId: true,
          status: true
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

  if (!booking.payment || !isPaymentAuthorizedForDispatch(booking.payment.status)) {
    return { booking, notifiedDrivers: 0, skipped: true as const };
  }

  const activeDispatches = booking.dispatches.filter(
    (dispatch) => dispatch.status === BookingDispatchStatus.PENDING || dispatch.status === BookingDispatchStatus.ACCEPTED
  );
  if (activeDispatches.length > 0) {
    return { booking, notifiedDrivers: activeDispatches.length, skipped: true as const };
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

  const eligibleDrivers = await findEligibleDrivers(
    booking.requestType,
    booking.zoneCode,
    booking.scheduledStartAt,
    booking.expectedDurationMinutes,
    Number(booking.pickupLat),
    Number(booking.pickupLng),
    booking.pickupLocation,
    Math.max(appConfig.driverDispatchFanout * 5, 50)
  );
  // A driver sees each request only once. Later retries can reach newly available drivers.
  const offeredDriverIds = new Set(booking.dispatches.map((dispatch) => dispatch.driverId));
  const unofferedDrivers = eligibleDrivers.filter((driver) => !offeredDriverIds.has(driver.id));
  const drivers = booking.preferredDriverId
    ? [
        ...unofferedDrivers.filter((driver) => driver.id === booking.preferredDriverId),
        ...unofferedDrivers.filter((driver) => driver.id !== booking.preferredDriverId)
      ].slice(0, appConfig.driverDispatchFanout)
    : unofferedDrivers.slice(0, appConfig.driverDispatchFanout);

  if (drivers.length) {
    const expiresAt = bookingDispatchExpiresAt();
    await prisma.bookingDispatch.createMany({
      data: drivers.map((driver) => ({
        bookingId: booking.id,
        driverId: driver.id,
        distanceKm: driver.distanceKm,
        status: BookingDispatchStatus.PENDING,
        expiresAt
      })),
      // Another dispatch attempt may win a race; duplicate offers stay harmless.
      skipDuplicates: true
    });

    const pendingOffers = await prisma.bookingDispatch.findMany({
      where: { bookingId: booking.id, driverId: { in: drivers.map((driver) => driver.id) }, status: BookingDispatchStatus.PENDING },
      select: { id: true, driverId: true, expiresAt: true }
    });
    const offersByDriverId = new Map(pendingOffers.map((offer) => [offer.driverId, offer]));

    await notifyUsers(
      drivers.filter((driver) => offersByDriverId.has(driver.id)).map((driver) => ({
        userId: driver.userId,
        type: "BOOKING_SUBMITTED" as const,
        title: "New ChaufX Booking Request",
        body:
          booking.requestType === "NOW"
            ? `${booking.pickupLocation} to ${booking.destinationLocation} · starting soon`
            : `${booking.pickupLocation} to ${booking.destinationLocation} · ${booking.scheduledStartAt.toLocaleString()}`,
        channel: "PUSH" as const,
        meta: {
          bookingId: booking.id,
          dispatchId: offersByDriverId.get(driver.id)!.id,
          expiresAt: offersByDriverId.get(driver.id)!.expiresAt?.toISOString() ?? expiresAt.toISOString(),
          distanceKm: driver.distanceKm,
          requestType: booking.requestType
        },
        dedupeKey: `booking-dispatch:${booking.id}:${driver.id}`
      }))
    );

    console.info("booking_dispatch_created", JSON.stringify({ bookingId: booking.id, offers: pendingOffers.length, expiresAt: expiresAt.toISOString() }));
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

/**
 * Retries paid requests that were created before any eligible driver was online.
 * The booking-level dispatcher prevents requests already offered to a driver from
 * being sent again.
 */
export async function dispatchOutstandingPaidBookings(limit: number = 25) {
  await expireTimedOutDispatches();
  const bookings = await prisma.booking.findMany({
    where: {
      status: {
        in: [BookingStatus.AWAITING_PAYMENT, BookingStatus.PENDING]
      },
      assignedDriverId: null,
      activationWindowEndAt: {
        gt: new Date()
      },
      payment: {
        is: {
          status: { in: [PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED, PaymentStatus.RECORDED] }
        }
      },
      dispatches: {
        none: {
          status: {
            in: [BookingDispatchStatus.PENDING, BookingDispatchStatus.ACCEPTED]
          }
        }
      }
    },
    select: {
      id: true
    },
    orderBy: {
      scheduledStartAt: "asc"
    },
    take: limit
  });

  const results = [];
  for (const booking of bookings) {
    results.push(await dispatchBookingToEligibleDrivers(booking.id));
  }

  return results;
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

  if (booking.status !== BookingStatus.AWAITING_PAYMENT && booking.status !== BookingStatus.PENDING) {
    throw new AppError(
      "This booking can no longer be cancelled in the app. Contact support if you need assistance.",
      409,
      "BOOKING_CANCELLATION_LOCKED"
    );
  }

  return booking;
}
