import { PaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isPaymentAuthorizedForDispatch, isPaymentCaptured } from "../src/modules/payments/payment-status.js";

describe("manual capture payment states", () => {
  it("dispatches a booking only after a card authorization or capture", () => {
    expect(isPaymentAuthorizedForDispatch(PaymentStatus.PENDING)).toBe(false);
    expect(isPaymentAuthorizedForDispatch(PaymentStatus.FAILED)).toBe(false);
    expect(isPaymentAuthorizedForDispatch(PaymentStatus.AUTHORIZATION_RELEASED)).toBe(false);
    expect(isPaymentAuthorizedForDispatch(PaymentStatus.AUTHORIZED)).toBe(true);
    expect(isPaymentAuthorizedForDispatch(PaymentStatus.CAPTURED)).toBe(true);
  });

  it("allows trip activity only after a successful capture", () => {
    expect(isPaymentCaptured(PaymentStatus.AUTHORIZED)).toBe(false);
    expect(isPaymentCaptured(PaymentStatus.AUTHORIZATION_RELEASED)).toBe(false);
    expect(isPaymentCaptured(PaymentStatus.CAPTURED)).toBe(true);
    // Existing paid trips retain their pre-rollout recorded status.
    expect(isPaymentCaptured(PaymentStatus.RECORDED)).toBe(true);
  });
});
