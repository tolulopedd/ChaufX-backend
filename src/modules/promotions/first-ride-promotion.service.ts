import {
  BookingStatus,
  FirstRidePromotionRedemptionStatus,
  MembershipTier,
  Prisma,
  PromotionDiscountType
} from "@prisma/client";
import { AppError } from "../../common/AppError.js";
import { prisma } from "../../lib/prisma.js";

export const firstRidePromotionConfigId = "first-ride";

export type FirstRidePromotionQuote = {
  eligible: boolean;
  originalFare: number;
  discountAmount: number;
  discountedFare: number;
  reason?: string;
};

function money(value: number) {
  return Number(Math.max(0, value).toFixed(2));
}

export function quoteFirstRidePromotion(
  config: {
    enabled: boolean;
    discountType: PromotionDiscountType;
    discountValue: number;
    maxDiscountAmount: number | null;
    minimumBookingAmount: number;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    usageCount: number;
    eligibleMembershipTiers: MembershipTier[];
    combineWithMembershipRates: boolean;
  } | null,
  input: { fare: number; membershipTier: MembershipTier; membershipApplied: boolean; hasCompletedRide: boolean; hasReservedPromotion: boolean },
  now = new Date()
): FirstRidePromotionQuote {
  const originalFare = money(input.fare);
  const unavailable = (reason: string): FirstRidePromotionQuote => ({ eligible: false, originalFare, discountAmount: 0, discountedFare: originalFare, reason });
  if (!config?.enabled) return unavailable("Promotion is not active.");
  if (config.startsAt && config.startsAt > now) return unavailable("Promotion has not started.");
  if (config.endsAt && config.endsAt < now) return unavailable("Promotion has ended.");
  if (config.usageLimit !== null && config.usageCount >= config.usageLimit) return unavailable("Promotion usage limit reached.");
  if (input.hasCompletedRide || input.hasReservedPromotion) return unavailable("First ride promotion already used or reserved.");
  if (config.eligibleMembershipTiers.length && !config.eligibleMembershipTiers.includes(input.membershipTier)) return unavailable("Membership is not eligible.");
  if (!config.combineWithMembershipRates && input.membershipApplied) return unavailable("Promotion cannot be combined with your membership rate.");
  if (originalFare < config.minimumBookingAmount) return unavailable("Booking does not meet the promotion minimum.");

  let discount = config.discountType === PromotionDiscountType.PERCENTAGE
    ? originalFare * (config.discountValue / 100)
    : config.discountValue;
  if (config.maxDiscountAmount !== null) discount = Math.min(discount, config.maxDiscountAmount);
  discount = money(Math.min(originalFare, discount));
  if (!discount) return unavailable("Promotion discount is not configured.");
  return { eligible: true, originalFare, discountAmount: discount, discountedFare: money(originalFare - discount) };
}

export async function getFirstRidePromotionQuote(input: {
  customerUserId: string;
  fare: number;
  membershipTier: MembershipTier;
  membershipApplied: boolean;
}) {
  const [config, customer] = await Promise.all([
    prisma.firstRidePromotionConfig.findUnique({ where: { id: firstRidePromotionConfigId } }),
    prisma.customerProfile.findUnique({
      where: { userId: input.customerUserId },
      select: { id: true, firstRidePromotionReservedId: true, firstRidePromotionRedeemedAt: true }
    })
  ]);
  if (!customer) return quoteFirstRidePromotion(config, { ...input, hasCompletedRide: true, hasReservedPromotion: false });
  const completed = customer.firstRidePromotionRedeemedAt
    ? true
    : Boolean(await prisma.booking.findFirst({ where: { customerId: customer.id, status: BookingStatus.COMPLETED }, select: { id: true } }));
  return quoteFirstRidePromotion(config, {
    fare: input.fare,
    membershipTier: input.membershipTier,
    membershipApplied: input.membershipApplied,
    hasCompletedRide: completed,
    hasReservedPromotion: Boolean(customer.firstRidePromotionReservedId)
  });
}

export async function reserveFirstRidePromotion(
  tx: Prisma.TransactionClient,
  input: { bookingId: string; customerId: string; membershipTier: MembershipTier; membershipApplied: boolean; fare: number }
) {
  const [config, customer, completedBooking] = await Promise.all([
    tx.firstRidePromotionConfig.findUnique({ where: { id: firstRidePromotionConfigId } }),
    tx.customerProfile.findUniqueOrThrow({ where: { id: input.customerId }, select: { firstRidePromotionReservedId: true, firstRidePromotionRedeemedAt: true } }),
    tx.booking.findFirst({ where: { customerId: input.customerId, status: BookingStatus.COMPLETED }, select: { id: true } })
  ]);
  const quote = quoteFirstRidePromotion(config, {
    fare: input.fare,
    membershipTier: input.membershipTier,
    membershipApplied: input.membershipApplied,
    hasCompletedRide: Boolean(customer.firstRidePromotionRedeemedAt || completedBooking),
    hasReservedPromotion: Boolean(customer.firstRidePromotionReservedId)
  });
  if (!quote.eligible || !config) return quote;

  const reservedConfig = await tx.firstRidePromotionConfig.updateMany({
    where: { id: config.id, enabled: true, ...(config.usageLimit === null ? {} : { usageCount: { lt: config.usageLimit } }) },
    data: { usageCount: { increment: 1 } }
  });
  if (!reservedConfig.count) return { ...quote, eligible: false, discountAmount: 0, discountedFare: quote.originalFare, reason: "Promotion usage limit reached." };

  const redemption = await tx.firstRidePromotionRedemption.create({
    data: { configId: config.id, customerId: input.customerId, bookingId: input.bookingId, originalFare: quote.originalFare, discountAmount: quote.discountAmount }
  });
  const claimedCustomer = await tx.customerProfile.updateMany({
    where: { id: input.customerId, firstRidePromotionReservedId: null, firstRidePromotionRedeemedAt: null },
    data: { firstRidePromotionReservedId: redemption.id }
  });
  if (!claimedCustomer.count) throw new AppError("A first ride promotion is already reserved for this customer.", 409, "FIRST_RIDE_PROMOTION_ALREADY_RESERVED");
  return quote;
}

export async function releaseFirstRidePromotion(tx: Prisma.TransactionClient, bookingId: string) {
  const redemption = await tx.firstRidePromotionRedemption.findUnique({ where: { bookingId } });
  if (!redemption || redemption.status !== FirstRidePromotionRedemptionStatus.RESERVED) return false;
  await tx.firstRidePromotionRedemption.update({ where: { id: redemption.id }, data: { status: FirstRidePromotionRedemptionStatus.RELEASED, releasedAt: new Date() } });
  await tx.customerProfile.updateMany({ where: { id: redemption.customerId, firstRidePromotionReservedId: redemption.id }, data: { firstRidePromotionReservedId: null } });
  await tx.firstRidePromotionConfig.update({ where: { id: redemption.configId }, data: { usageCount: { decrement: 1 } } });
  return true;
}

export async function redeemFirstRidePromotion(tx: Prisma.TransactionClient, bookingId: string, redeemedAt = new Date()) {
  const redemption = await tx.firstRidePromotionRedemption.findUnique({ where: { bookingId } });
  if (!redemption || redemption.status !== FirstRidePromotionRedemptionStatus.RESERVED) return false;
  await tx.firstRidePromotionRedemption.update({ where: { id: redemption.id }, data: { status: FirstRidePromotionRedemptionStatus.REDEEMED, redeemedAt } });
  await tx.customerProfile.updateMany({ where: { id: redemption.customerId, firstRidePromotionReservedId: redemption.id }, data: { firstRidePromotionReservedId: null, firstRidePromotionRedeemedAt: redeemedAt } });
  return true;
}
