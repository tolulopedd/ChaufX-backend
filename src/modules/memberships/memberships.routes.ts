import { MembershipBillingCycle, MembershipPaymentMethod, MembershipPaymentStatus, MembershipTier } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { env } from "../../config/env.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import {
  activateMembershipPayment,
  createMembershipInvoiceNumber,
  getMembershipFee,
  getMembershipPlan,
  membershipPlans,
  serializeMembershipPayment
} from "./membership.service.js";

export const membershipsRoutes = Router();

type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status: string;
  status: string;
  client_reference_id?: string | null;
};

function getCheckoutBaseUrl() {
  return env.CLIENT_APP_URL.replace(/\/+$/, "");
}

function getPublicApiBaseUrl() {
  return env.API_PUBLIC_URL.replace(/\/+$/, "");
}

function ensureStripeConfigured() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      "Stripe payment is not configured yet for this environment. Add STRIPE_SECRET_KEY on the backend service.",
      503,
      "PAYMENT_NOT_CONFIGURED"
    );
  }
}

async function createStripeMembershipCheckoutSession(input: {
  paymentId: string;
  amount: number;
  currency: string;
  customerEmail?: string | null;
  description: string;
  invoiceNumber: string;
  tier: MembershipTier;
  billingCycle: MembershipBillingCycle;
  successReturnUrl?: string | null;
  cancelReturnUrl?: string | null;
}) {
  ensureStripeConfigured();

  const form = new URLSearchParams();
  const successUrlBase = `${getPublicApiBaseUrl()}/api/memberships/checkout/complete`;
  const successQuery = new URLSearchParams();
  successQuery.set("paymentId", input.paymentId);

  if (input.successReturnUrl) {
    successQuery.set("return_url", input.successReturnUrl);
  }

  const cancelUrlBase = `${getPublicApiBaseUrl()}/api/memberships/checkout/cancel`;
  const cancelQuery = new URLSearchParams();
  cancelQuery.set("paymentId", input.paymentId);

  if (input.cancelReturnUrl) {
    cancelQuery.set("return_url", input.cancelReturnUrl);
  }

  form.set("mode", "payment");
  form.set("success_url", `${successUrlBase}?${successQuery.toString()}&session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${cancelUrlBase}?${cancelQuery.toString()}`);
  form.set("client_reference_id", input.paymentId);
  form.set("metadata[membershipPaymentId]", input.paymentId);
  form.set("metadata[invoiceNumber]", input.invoiceNumber);
  form.set("metadata[membershipTier]", input.tier);
  form.set("metadata[billingCycle]", input.billingCycle);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(input.amount * 100)));
  form.set("line_items[0][price_data][product_data][name]", `ChaufX ${getMembershipPlan(input.tier).label} membership`);
  form.set("line_items[0][price_data][product_data][description]", input.description);

  if (input.customerEmail) {
    form.set("customer_email", input.customerEmail);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new AppError(
      payload?.error?.message ?? "Unable to create a Stripe checkout session right now.",
      502,
      "PAYMENT_PROVIDER_ERROR"
    );
  }

  return payload as StripeCheckoutSession;
}

async function retrieveStripeCheckoutSession(sessionId: string) {
  ensureStripeConfigured();

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
    }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new AppError(
      payload?.error?.message ?? "Unable to verify the Stripe checkout session.",
      502,
      "PAYMENT_PROVIDER_ERROR"
    );
  }

  return payload as StripeCheckoutSession;
}

export const membershipCheckoutCompleteHandler = asyncHandler(async (request, response) => {
  const schema = z.object({
    paymentId: z.string().uuid(),
    session_id: z.string().min(1),
    return_url: z.string().optional()
  });
  const input = schema.parse(request.query);
  const session = await retrieveStripeCheckoutSession(input.session_id);

  if (session.client_reference_id && session.client_reference_id !== input.paymentId) {
    throw new AppError("This checkout session does not belong to the requested membership invoice.", 409, "MEMBERSHIP_PAYMENT_MISMATCH");
  }

  if (session.payment_status === "paid") {
    await activateMembershipPayment(input.paymentId, { stripeSessionId: session.id });
  } else if (session.status === "expired") {
    await prisma.membershipPayment.update({
      where: { id: input.paymentId },
      data: {
        status: MembershipPaymentStatus.FAILED,
        stripeSessionId: session.id,
        notes: "Stripe membership checkout expired before payment completed."
      }
    });
  }

  const fallbackUrl = `${getCheckoutBaseUrl()}/membership-complete?paymentId=${input.paymentId}&session_id=${encodeURIComponent(input.session_id)}`;
  const redirectUrl = input.return_url ? new URL(input.return_url) : new URL(fallbackUrl);
  redirectUrl.searchParams.set("paymentId", input.paymentId);
  redirectUrl.searchParams.set("session_id", input.session_id);

  response.redirect(302, redirectUrl.toString());
});

export const membershipCheckoutCancelHandler = asyncHandler(async (request, response) => {
  const schema = z.object({
    paymentId: z.string().uuid(),
    return_url: z.string().optional()
  });
  const input = schema.parse(request.query);

  await prisma.membershipPayment.updateMany({
    where: {
      id: input.paymentId,
      status: MembershipPaymentStatus.PENDING
    },
    data: {
      status: MembershipPaymentStatus.CANCELLED,
      notes: "Stripe membership checkout was cancelled."
    }
  });

  const fallbackUrl = `${getCheckoutBaseUrl()}/membership-cancelled?paymentId=${input.paymentId}`;
  const redirectUrl = input.return_url ? new URL(input.return_url) : new URL(fallbackUrl);
  redirectUrl.searchParams.set("paymentId", input.paymentId);

  response.redirect(302, redirectUrl.toString());
});

membershipsRoutes.use(requireAuth);

membershipsRoutes.get(
  "/memberships/plans",
  asyncHandler(async (_request, response) => {
    response.json({
      plans: Object.values(membershipPlans)
    });
  })
);

membershipsRoutes.get(
  "/memberships/me",
  requireRole(["customer", "admin"]),
  asyncHandler(async (request, response) => {
    const userId = request.auth!.userId;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        membershipPayments: {
          orderBy: { createdAt: "desc" },
          take: 10
        }
      }
    });

    response.json({
      membership: {
        tier: user.membershipTier,
        status: user.membershipStatus,
        billingCycle: user.membershipBillingCycle,
        hourlyRate: user.membershipHourlyRate,
        activatedAt: user.membershipActivatedAt?.toISOString() ?? null,
        expiresAt: user.membershipExpiresAt?.toISOString() ?? null
      },
      payments: user.membershipPayments.map(serializeMembershipPayment)
    });
  })
);

membershipsRoutes.post(
  "/memberships/stripe-checkout-session",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const schema = z.object({
      tier: z.enum([MembershipTier.PLUS, MembershipTier.CONCIERGE]),
      billingCycle: z.enum([MembershipBillingCycle.MONTHLY, MembershipBillingCycle.ANNUAL]),
      successReturnUrl: z.string().optional(),
      cancelReturnUrl: z.string().optional()
    });
    const input = schema.parse(request.body ?? {});
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.auth!.userId }
    });
    const amount = getMembershipFee(input.tier, input.billingCycle);
    const invoiceNumber = createMembershipInvoiceNumber();

    const payment = await prisma.membershipPayment.create({
      data: {
        userId: user.id,
        tier: input.tier,
        billingCycle: input.billingCycle,
        method: MembershipPaymentMethod.STRIPE,
        amount,
        currency: "CAD",
        invoiceNumber,
        notes: "Stripe membership checkout session created."
      }
    });

    const session = await createStripeMembershipCheckoutSession({
      paymentId: payment.id,
      amount,
      currency: "CAD",
      customerEmail: user.email,
      description: `${getMembershipPlan(input.tier).label} membership invoice ${invoiceNumber}`,
      invoiceNumber,
      tier: input.tier,
      billingCycle: input.billingCycle,
      successReturnUrl: input.successReturnUrl,
      cancelReturnUrl: input.cancelReturnUrl
    });

    const updatedPayment = await prisma.membershipPayment.update({
      where: { id: payment.id },
      data: {
        stripeSessionId: session.id
      }
    });

    response.status(201).json({
      checkoutUrl: session.url,
      sessionId: session.id,
      payment: serializeMembershipPayment(updatedPayment)
    });
  })
);

membershipsRoutes.post(
  "/memberships/interac-request",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const schema = z.object({
      tier: z.enum([MembershipTier.PLUS, MembershipTier.CONCIERGE]),
      billingCycle: z.enum([MembershipBillingCycle.MONTHLY, MembershipBillingCycle.ANNUAL]),
      interacEmail: z.string().email()
    });
    const input = schema.parse(request.body ?? {});
    const amount = getMembershipFee(input.tier, input.billingCycle);
    const invoiceNumber = createMembershipInvoiceNumber();

    const payment = await prisma.membershipPayment.create({
      data: {
        userId: request.auth!.userId,
        tier: input.tier,
        billingCycle: input.billingCycle,
        method: MembershipPaymentMethod.INTERAC,
        amount,
        currency: "CAD",
        invoiceNumber,
        interacEmail: input.interacEmail,
        notes: "Interac e-transfer requested. Membership activates after payment is recorded."
      }
    });

    response.status(201).json({
      payment: serializeMembershipPayment(payment),
      instructions: {
        invoiceNumber,
        amount,
        currency: "CAD",
        interacEmail: input.interacEmail,
        status: "AWAITING_MANUAL_PAYMENT"
      }
    });
  })
);

membershipsRoutes.get(
  "/admin/memberships/payments",
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const schema = z.object({
      status: z.nativeEnum(MembershipPaymentStatus).optional()
    });
    const input = schema.parse(request.query);
    const payments = await prisma.membershipPayment.findMany({
      where: input.status ? { status: input.status } : undefined,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            membershipTier: true,
            membershipStatus: true,
            membershipBillingCycle: true,
            membershipHourlyRate: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    response.json({
      payments: payments.map(({ user, ...payment }) => ({
        ...serializeMembershipPayment(payment),
        user
      }))
    });
  })
);

membershipsRoutes.post(
  "/admin/memberships/:paymentId/record",
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const paymentId = paramValue(request.params.paymentId);
    const result = await activateMembershipPayment(paymentId);

    response.json({
      membership: {
        userId: result.user.id,
        tier: result.user.membershipTier,
        status: result.user.membershipStatus,
        billingCycle: result.user.membershipBillingCycle,
        hourlyRate: result.user.membershipHourlyRate,
        activatedAt: result.user.membershipActivatedAt?.toISOString() ?? null,
        expiresAt: result.user.membershipExpiresAt?.toISOString() ?? null
      },
      payment: serializeMembershipPayment(result.payment)
    });
  })
);
