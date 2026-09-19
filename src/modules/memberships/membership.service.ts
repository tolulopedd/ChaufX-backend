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

const membershipPricingPrefix = "MEMBERSHIP::";

type MembershipPlan = {
  tier: MembershipTier;
  label: string;
  hourlyRate: number | null;
  monthlyFee: number | null;
  annualFee: number | null;
};

function membershipPricingCode(tier: MembershipTier, kind: "HOURLY_RATE" | "MONTHLY_FEE" | "ANNUAL_FEE") {
  return `${membershipPricingPrefix}${tier}::${kind}`;
}

export async function getConfiguredMembershipPlans(): Promise<Record<MembershipTier, MembershipPlan>> {
  const settings = await prisma.pricingSetting.findMany({
    where: { code: { startsWith: membershipPricingPrefix } },
    select: { code: true, value: true }
  });
  const plans: Record<MembershipTier, MembershipPlan> = {
    BASIC: { ...membershipPlans.BASIC },
    PLUS: { ...membershipPlans.PLUS },
    CONCIERGE: { ...membershipPlans.CONCIERGE },
    CORPORATE: { ...membershipPlans.CORPORATE }
  };

  for (const setting of settings) {
    const [, tier, kind] = setting.code.split("::");
    if (tier !== MembershipTier.PLUS && tier !== MembershipTier.CONCIERGE) {
      continue;
    }

    if (kind === "HOURLY_RATE") {
      plans[tier].hourlyRate = setting.value;
    }

    if (kind === "MONTHLY_FEE") {
      plans[tier].monthlyFee = setting.value;
    }

    if (kind === "ANNUAL_FEE") {
      plans[tier].annualFee = setting.value;
    }
  }

  return plans;
}

export function membershipPricingSettingsForPlans(plans: Pick<Record<MembershipTier, MembershipPlan>, "PLUS" | "CONCIERGE">) {
  return [MembershipTier.PLUS, MembershipTier.CONCIERGE].flatMap((tier) => {
    const plan = plans[tier];
    return [
      {
        code: membershipPricingCode(tier, "HOURLY_RATE"),
        name: `${plan.label} membership hourly rate`,
        value: plan.hourlyRate ?? 0,
        description: `${plan.label} member hourly rate.`
      },
      {
        code: membershipPricingCode(tier, "MONTHLY_FEE"),
        name: `${plan.label} monthly membership fee`,
        value: plan.monthlyFee ?? 0,
        description: `${plan.label} monthly membership fee.`
      },
      {
        code: membershipPricingCode(tier, "ANNUAL_FEE"),
        name: `${plan.label} annual membership fee`,
        value: plan.annualFee ?? 0,
        description: `${plan.label} annual membership fee.`
      }
    ];
  });
}

export function getMembershipPlan(tier: MembershipTier) {
  return membershipPlans[tier];
}

export async function getMembershipFee(tier: MembershipTier, billingCycle: MembershipBillingCycle) {
  const plan = (await getConfiguredMembershipPlans())[tier];

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

export async function getActiveMembershipHourlyRate(
  user: Pick<User, "membershipTier" | "membershipStatus" | "membershipHourlyRate">
) {
  if (user.membershipStatus !== MembershipStatus.ACTIVE) {
    return null;
  }

  if (user.membershipTier === MembershipTier.PLUS) {
    return (await getConfiguredMembershipPlans()).PLUS.hourlyRate;
  }

  if (user.membershipTier === MembershipTier.CONCIERGE) {
    return (await getConfiguredMembershipPlans()).CONCIERGE.hourlyRate;
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

export function getMembershipExpiresAt(start: Date, billingCycle: MembershipBillingCycle) {
  const expiresAt = new Date(start);
  const originalDay = start.getDate();

  // Set the day after changing the period so month-end dates stay in the next billing period.
  expiresAt.setDate(1);

  if (billingCycle === MembershipBillingCycle.MONTHLY) {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    expiresAt.setDate(Math.min(originalDay, new Date(expiresAt.getFullYear(), expiresAt.getMonth() + 1, 0).getDate()));
    return expiresAt;
  }

  if (billingCycle === MembershipBillingCycle.ANNUAL) {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    expiresAt.setDate(Math.min(originalDay, new Date(expiresAt.getFullYear(), expiresAt.getMonth() + 1, 0).getDate()));
    return expiresAt;
  }

  return null;
}

export async function activateMembershipPayment(paymentId: string, options?: { stripeSessionId?: string | null }) {
  const configuredPlans = await getConfiguredMembershipPlans();

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

    const plan = configuredPlans[payment.tier];
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
    interacInstructionsExpiresAt: payment.interacInstructionsExpiresAt?.toISOString() ?? null,
    interacTransferConfirmedAt: payment.interacTransferConfirmedAt?.toISOString() ?? null,
    recordedAt: payment.recordedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString()
  };
}
