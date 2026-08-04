import {
  MembershipBillingCycle,
  MembershipPaymentStatus,
  MembershipStatus,
  MembershipTier,
  type MembershipPayment,
  type User
} from "@prisma/client";
import { AppError } from "../../common/AppError.js";
import { prisma } from "../../lib/prisma.js";

export const membershipPlans = {
  BASIC: {
    tier: MembershipTier.BASIC,
    label: "Basic",
    hourlyRate: null,
    monthlyFee: 0,
    annualFee: 0
  },
  PLUS: {
    tier: MembershipTier.PLUS,
    label: "Plus",
    hourlyRate: 29,
    monthlyFee: 100,
    annualFee: 999
  },
  CONCIERGE: {
    tier: MembershipTier.CONCIERGE,
    label: "Concierge",
    hourlyRate: 25,
    monthlyFee: 200,
    annualFee: 2199
  },
  CORPORATE: {
    tier: MembershipTier.CORPORATE,
    label: "Corporate",
    hourlyRate: null,
    monthlyFee: null,
    annualFee: null
  }
} as const;

export function getMembershipPlan(tier: MembershipTier) {
  return membershipPlans[tier];
}

export function getMembershipFee(tier: MembershipTier, billingCycle: MembershipBillingCycle) {
  const plan = getMembershipPlan(tier);

  if (tier !== MembershipTier.PLUS && tier !== MembershipTier.CONCIERGE) {
    throw new AppError("This membership tier is not available for self-service activation.", 400, "MEMBERSHIP_TIER_UNAVAILABLE");
  }

  if (billingCycle === MembershipBillingCycle.MONTHLY) {
    return plan.monthlyFee ?? 0;
  }

  if (billingCycle === MembershipBillingCycle.ANNUAL) {
    return plan.annualFee ?? 0;
  }

  throw new AppError("Choose monthly or annual billing for this membership.", 400, "MEMBERSHIP_BILLING_INVALID");
}

export function getActiveMembershipHourlyRate(
  user: Pick<User, "membershipTier" | "membershipStatus" | "membershipHourlyRate">
) {
  if (user.membershipStatus !== MembershipStatus.ACTIVE) {
    return null;
  }

  if (user.membershipTier === MembershipTier.PLUS) {
    return membershipPlans.PLUS.hourlyRate;
  }

  if (user.membershipTier === MembershipTier.CONCIERGE) {
    return membershipPlans.CONCIERGE.hourlyRate;
  }

  if (user.membershipTier === MembershipTier.CORPORATE) {
    return user.membershipHourlyRate;
  }

  return null;
}

export function createMembershipInvoiceNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `CHX-MEM-${datePart}-${randomPart}`;
}

function getMembershipExpiresAt(start: Date, billingCycle: MembershipBillingCycle) {
  const expiresAt = new Date(start);

  if (billingCycle === MembershipBillingCycle.MONTHLY) {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    return expiresAt;
  }

  if (billingCycle === MembershipBillingCycle.ANNUAL) {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    return expiresAt;
  }

  return null;
}

export async function activateMembershipPayment(paymentId: string, options?: { stripeSessionId?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.membershipPayment.findUnique({
      where: { id: paymentId },
      include: {
        user: true
      }
    });

    if (!payment) {
      throw new AppError("Membership payment not found.", 404, "MEMBERSHIP_PAYMENT_NOT_FOUND");
    }

    const plan = getMembershipPlan(payment.tier);
    const activatedAt = payment.recordedAt ?? new Date();
    const expiresAt = getMembershipExpiresAt(activatedAt, payment.billingCycle);
    const hourlyRate = payment.tier === MembershipTier.CORPORATE ? payment.user.membershipHourlyRate : plan.hourlyRate;

    const updatedPayment = await tx.membershipPayment.update({
      where: { id: payment.id },
      data: {
        status: MembershipPaymentStatus.RECORDED,
        stripeSessionId: options?.stripeSessionId ?? payment.stripeSessionId,
        recordedAt: activatedAt,
        notes: payment.method === "STRIPE" ? "Stripe membership payment recorded." : "Interac membership payment recorded."
      }
    });

    const user = await tx.user.update({
      where: { id: payment.userId },
      data: {
        membershipTier: payment.tier,
        membershipStatus: MembershipStatus.ACTIVE,
        membershipBillingCycle: payment.billingCycle,
        membershipHourlyRate: hourlyRate,
        membershipActivatedAt: activatedAt,
        membershipExpiresAt: expiresAt
      }
    });

    return { payment: updatedPayment, user };
  });
}

export function serializeMembershipPayment(payment: MembershipPayment) {
  return {
    id: payment.id,
    tier: payment.tier,
    billingCycle: payment.billingCycle,
    method: payment.method,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    invoiceNumber: payment.invoiceNumber,
    interacEmail: payment.interacEmail,
    recordedAt: payment.recordedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString()
  };
}
