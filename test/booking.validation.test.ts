import { describe, expect, it } from "vitest";
import { createBookingSchema, validateBookingStartTime } from "../src/modules/bookings/bookings.routes.js";

describe("booking validation", () => {
  it("rejects too-short pickup labels", () => {
    const result = createBookingSchema.safeParse({
      requestType: "NOW",
      pickupLocation: "A",
      pickupLat: 49.89,
      pickupLng: -97.13,
      destinationLocation: "Downtown Winnipeg",
      destinationLat: 49.88,
      destinationLng: -97.11,
      scheduledStartAt: new Date().toISOString(),
      expectedDurationMinutes: 60,
      zoneCode: "WPG-CENTRAL"
    });

    expect(result.success).toBe(false);
  });

  it("requires scheduled requests to start at least one hour ahead", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");

    expect(validateBookingStartTime("LATER", new Date("2026-10-03T12:59:59.999Z"), now)).toBe(false);
    expect(validateBookingStartTime("LATER", new Date("2026-10-03T13:00:00.000Z"), now)).toBe(true);
  });

  it("rejects Book Now requests whose start time has already passed", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");

    expect(validateBookingStartTime("NOW", new Date("2026-10-03T11:59:59.999Z"), now)).toBe(false);
    expect(validateBookingStartTime("NOW", new Date("2026-10-03T12:00:00.000Z"), now)).toBe(true);
  });
});
