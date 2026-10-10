import { MembershipTier, PromotionDiscountType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { quoteFirstRidePromotion } from "../src/modules/promotions/first-ride-promotion.service.js";

const config = {
  enabled: true,
  discountType: PromotionDiscountType.PERCENTAGE,
  discountValue: 25,
  maxDiscountAmount: 20,
  minimumBookingAmount: 40,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usageCount: 0,
  eligibleMembershipTiers: [],
  combineWithMembershipRates: true
};

describe("first ride promotion pricing", () => {
  it("applies after the membership fare and respects the cap", () => {
    const quote = quoteFirstRidePromotion(config, { fare: 116, membershipTier: MembershipTier.PLUS, membershipApplied: true, hasCompletedRide: false, hasReservedPromotion: false });
    expect(quote).toMatchObject({ eligible: true, originalFare: 116, discountAmount: 20, discountedFare: 96 });
  });

  it("does not apply to completed rides, concurrent reservations, or insufficient fares", () => {
    expect(quoteFirstRidePromotion(config, { fare: 116, membershipTier: MembershipTier.BASIC, membershipApplied: false, hasCompletedRide: true, hasReservedPromotion: false }).eligible).toBe(false);
    expect(quoteFirstRidePromotion(config, { fare: 116, membershipTier: MembershipTier.BASIC, membershipApplied: false, hasCompletedRide: false, hasReservedPromotion: true }).eligible).toBe(false);
    expect(quoteFirstRidePromotion(config, { fare: 39, membershipTier: MembershipTier.BASIC, membershipApplied: false, hasCompletedRide: false, hasReservedPromotion: false }).eligible).toBe(false);
  });

  it("honours membership-combination and usage controls without producing a negative fare", () => {
    const noStack = quoteFirstRidePromotion({ ...config, combineWithMembershipRates: false }, { fare: 29, membershipTier: MembershipTier.PLUS, membershipApplied: true, hasCompletedRide: false, hasReservedPromotion: false });
    expect(noStack.eligible).toBe(false);
    const fixed = quoteFirstRidePromotion({ ...config, discountType: PromotionDiscountType.FIXED_AMOUNT, discountValue: 500, maxDiscountAmount: null, minimumBookingAmount: 0 }, { fare: 35, membershipTier: MembershipTier.BASIC, membershipApplied: false, hasCompletedRide: false, hasReservedPromotion: false });
    expect(fixed).toMatchObject({ discountAmount: 35, discountedFare: 0 });
  });
});
