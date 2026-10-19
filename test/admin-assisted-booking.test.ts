import { BookingPaymentMethod, BookingStatus, PaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  assistedBookingSchema,
  canConfirmAdminAssistedInteracPayment,
  isValidAssistedBookingStartTime
} from "../src/modules/admin/admin.routes.js";

describe("admin-assisted booking safeguards", () => {
  it("requires at least two paid hours", () => {
    const result = assistedBookingSchema.safeParse({
      customerUserId: "00000000-0000-4000-8000-000000000001",
      requestType: "LATER",
      pickupLocation: "1 Portage Avenue, Winnipeg, Manitoba",
      pickupLat: 49.895,
      pickupLng: -97.138,
      scheduledStartAt: "2026-10-20T10:00:00.000Z",
      expectedDurationMinutes: 60,
      vehicleDetails: "Toyota Hilux",
      zoneCode: "Manitoba"
    });

    expect(result.success).toBe(false);
  });

  it("allows an optional destination while preserving valid booking fields", () => {
    const result = assistedBookingSchema.safeParse({
      customerUserId: "00000000-0000-4000-8000-000000000001",
      requestType: "LATER",
      pickupLocation: "1 Portage Avenue, Winnipeg, Manitoba",
      pickupLat: 49.895,
      pickupLng: -97.138,
      scheduledStartAt: "2026-10-20T10:00:00.000Z",
      expectedDurationMinutes: 120,
      vehicleDetails: "Toyota Hilux",
      zoneCode: "Manitoba"
    });

    expect(result.success).toBe(true);
  });

  it("keeps scheduled bookings at least one hour ahead", () => {
    const now = new Date("2026-10-18T12:00:00.000Z");
    expect(isValidAssistedBookingStartTime("LATER", new Date("2026-10-18T12:59:59.999Z"), now)).toBe(false);
    expect(isValidAssistedBookingStartTime("LATER", new Date("2026-10-18T13:00:00.000Z"), now)).toBe(true);
  });

  it("permits confirmation exactly once for an awaiting Interac booking", () => {
    expect(canConfirmAdminAssistedInteracPayment({
      method: BookingPaymentMethod.INTERAC,
      paymentStatus: PaymentStatus.PENDING,
      bookingStatus: BookingStatus.AWAITING_PAYMENT,
      adminAssistedAt: new Date()
    })).toBe(true);
    expect(canConfirmAdminAssistedInteracPayment({
      method: BookingPaymentMethod.INTERAC,
      paymentStatus: PaymentStatus.RECORDED,
      bookingStatus: BookingStatus.AWAITING_PAYMENT,
      adminAssistedAt: new Date()
    })).toBe(false);
    expect(canConfirmAdminAssistedInteracPayment({
      method: BookingPaymentMethod.STRIPE,
      paymentStatus: PaymentStatus.PENDING,
      bookingStatus: BookingStatus.AWAITING_PAYMENT,
      adminAssistedAt: new Date()
    })).toBe(false);
  });
});
