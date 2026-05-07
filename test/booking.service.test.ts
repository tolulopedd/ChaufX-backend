import { describe, expect, it } from "vitest";
import { haversineDistanceKm, mapStateForBooking, windowsOverlap } from "../src/modules/bookings/booking.service.js";

describe("booking.service", () => {
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
});
