import { describe, expect, it } from "vitest";
import { createBookingSchema } from "../src/modules/bookings/bookings.routes.js";

describe("booking validation", () => {
  it("rejects too-short pickup labels", () => {
    const result = createBookingSchema.safeParse({
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
});
