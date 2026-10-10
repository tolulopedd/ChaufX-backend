import { describe, expect, it } from "vitest";
import {
  findCanadianRegionByCoordinate,
  haversineDistanceKm,
  inferServiceRegion,
  isDriverReachable,
  bookingDispatchExpiresAt,
  mapStateForBooking,
  unacceptedBookingExpiresAt,
  windowsOverlap
} from "../src/modules/bookings/booking.service.js";
import { isTripExtensionReminderDue, paidTripEndAt } from "../src/modules/trips/trip-lifecycle.service.js";

describe("booking.service", () => {
  it("does not offer a paid extension more than fifteen minutes before expiry", () => {
    const now = new Date("2026-10-03T10:00:00.000Z");
    const endsAt = new Date("2026-10-03T10:15:01.000Z");

    expect(isTripExtensionReminderDue(endsAt, now)).toBe(false);
  });

  it("offers a paid extension when fifteen minutes remain", () => {
    const now = new Date("2026-10-03T10:00:00.000Z");
    const endsAt = new Date("2026-10-03T10:15:00.000Z");

    expect(isTripExtensionReminderDue(endsAt, now)).toBe(true);
  });

  it("calculates the exact paid trip end time from the booked duration", () => {
    const startedAt = new Date("2026-10-03T10:00:00.000Z");

    expect(paidTripEndAt(startedAt, 120).toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });

  it("detects overlapping trip windows", () => {
    const firstStart = new Date("2026-03-19T10:00:00.000Z");
    const firstEnd = new Date("2026-03-19T11:00:00.000Z");
    const secondStart = new Date("2026-03-19T10:30:00.000Z");
    const secondEnd = new Date("2026-03-19T11:30:00.000Z");

    expect(windowsOverlap(firstStart, firstEnd, secondStart, secondEnd)).toBe(true);
  });

  it("keeps the trip map locked outside the activation window", () => {
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const result = mapStateForBooking({
      id: "booking_123",
      status: "ACCEPTED",
      activationWindowStartAt: startsAt,
      activationWindowEndAt: endsAt
    });

    expect(result.active).toBe(false);
    expect(result.canNavigate).toBe(false);
  });

  it("calculates driver distance from the pickup point", () => {
    const distance = haversineDistanceKm(49.8959, -97.1385, 49.887, -97.1318);

    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(2);
  });

  it("detects Winnipeg from pickup coordinates when the address is unavailable", () => {
    const region = inferServiceRegion("WPG-CENTRAL", "", "", 49.8951, -97.1384);

    expect(region).toEqual({
      province: "Manitoba",
      city: "Winnipeg"
    });
  });

  it("uses the selected pickup province before the device location", () => {
    const region = inferServiceRegion(
      "WPG-CENTRAL",
      "1 King Street, Toronto, Ontario, Canada",
      undefined,
      43.6532,
      -79.3832,
      49.8951,
      -97.1384
    );

    expect(region).toEqual({
      province: "Ontario",
      city: "Toronto"
    });
  });

  it("falls back from unavailable device coordinates to the customer profile address", () => {
    const region = inferServiceRegion(
      "WPG-CENTRAL",
      undefined,
      undefined,
      undefined,
      undefined,
      0,
      0,
      "100 Portage Avenue, Winnipeg, Manitoba, Canada"
    );

    expect(region).toEqual({
      province: "Manitoba",
      city: "Winnipeg"
    });
  });

  it("maps coordinates outside Winnipeg to the matching Canadian province", () => {
    const region = findCanadianRegionByCoordinate(51.0447, -114.0719);

    expect(region).toEqual({
      province: "Alberta",
      city: undefined
    });
  });

  it("keeps an online driver reachable through a registered push device while the app is backgrounded", () => {
    const now = new Date("2026-10-09T12:00:00.000Z");
    expect(isDriverReachable(null, 1, now)).toBe(true);
  });

  it("uses heartbeat grace for active drivers without a push token", () => {
    const now = new Date("2026-10-09T12:00:00.000Z");
    expect(isDriverReachable(new Date("2026-10-09T11:59:00.000Z"), 0, now)).toBe(true);
    expect(isDriverReachable(new Date("2026-10-09T11:00:00.000Z"), 0, now)).toBe(false);
  });

  it("assigns an explicit response deadline to each booking offer", () => {
    const offeredAt = new Date("2026-10-09T12:00:00.000Z");
    expect(bookingDispatchExpiresAt(offeredAt).getTime()).toBeGreaterThan(offeredAt.getTime());
  });

  it("expires Book Now after one hour and scheduled requests after two hours or at their start time", () => {
    const authorizedAt = new Date("2026-10-10T10:00:00.000Z");
    const scheduledStartAt = new Date("2026-10-11T10:00:00.000Z");

    expect(unacceptedBookingExpiresAt({
      requestType: "NOW",
      scheduledStartAt,
      authorizedAt,
      createdAt: authorizedAt
    }).toISOString()).toBe("2026-10-10T11:00:00.000Z");
    expect(unacceptedBookingExpiresAt({
      requestType: "LATER",
      scheduledStartAt,
      authorizedAt,
      createdAt: authorizedAt
    }).toISOString()).toBe("2026-10-10T12:00:00.000Z");

    const nearerStart = new Date("2026-10-10T11:30:00.000Z");
    expect(unacceptedBookingExpiresAt({
      requestType: "LATER",
      scheduledStartAt: nearerStart,
      authorizedAt,
      createdAt: authorizedAt
    })).toEqual(nearerStart);
  });
});
