import { MembershipBillingCycle, MembershipPaymentMethod, MembershipPaymentStatus, MembershipStatus, MembershipTier } from "@prisma/client";
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
  getConfiguredMembershipPlans,
  getMembershipFee,
  getMembershipPlan,
  membershipPricingSettingsForPlans,
  serializeMembershipPayment
} from "./membership.service.js";

export const membershipsRoutes = Router();
const interacRecipientEmail = "payments@chaufx.ca";
const interacInstructionsTtlMs = 15 * 60 * 1000;

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

async function expireStripeMembershipCheckoutSession(sessionId: string) {
  if (!env.STRIPE_SECRET_KEY || !sessionId.startsWith("cs_")) {
    return;
  }

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
    }
  });

  if (response.ok) {
    return;
  }

  const payload = await response.json();
  if (payload?.error?.code === "checkout_session_expired") {
    return;
  }

  throw new AppError(
    payload?.error?.message ?? "Unable to cancel the Stripe checkout session right now.",
    502,
    "PAYMENT_PROVIDER_ERROR"
  );
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
      plans: Object.values(await getConfiguredMembershipPlans())
    });
  })
);

membershipsRoutes.get(
  "/admin/memberships/config",
  requireRole(["admin"]),
  asyncHandler(async (_request, response) => {
    const plans = await getConfiguredMembershipPlans();
    response.set("Cache-Control", "no-store");
    response.json({
      plans: [plans.PLUS, plans.CONCIERGE]
    });
  })
);

membershipsRoutes.put(
  "/admin/memberships/config",
  requireRole(["admin"]),
  asyncHandler(async (request, response) => {
    const planSchema = z.object({
      hourlyRate: z.coerce.number().min(0),
      monthlyFee: z.coerce.number().min(0),
      annualFee: z.coerce.number().min(0)
    });
    const input = z.object({
      plus: planSchema,
      concierge: planSchema
    }).parse(request.body ?? {});
    const currentPlans = await getConfiguredMembershipPlans();
    const plans = {
      [MembershipTier.PLUS]: { ...currentPlans.PLUS, ...input.plus },
      [MembershipTier.CONCIERGE]: { ...currentPlans.CONCIERGE, ...input.concierge }
    };

    await prisma.$transaction(
      membershipPricingSettingsForPlans(plans).map((setting) =>
        prisma.pricingSetting.upsert({
          where: { code: setting.code },
          create: setting,
          update: {
            value: setting.value,
            name: setting.name,
            description: setting.description
          }
        })
      )
    );

    response.json({ plans: [plans[MembershipTier.PLUS], plans[MembershipTier.CONCIERGE]] });
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
  "/memberships/downgrade",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    z.object({ tier: z.literal(MembershipTier.BASIC) }).parse(request.body ?? {});

    const user = await prisma.user.update({
      where: { id: request.auth!.userId },
      data: {
        membershipTier: MembershipTier.BASIC,
        membershipStatus: MembershipStatus.ACTIVE,
        membershipBillingCycle: MembershipBillingCycle.NONE,
        membershipHourlyRate: null,
        membershipActivatedAt: new Date(),
        membershipExpiresAt: null
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
      }
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
    const amount = await getMembershipFee(input.tier, input.billingCycle);
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
  "/memberships/:paymentId/cancel",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const paymentId = paramValue(request.params.paymentId);
    const payment = await prisma.membershipPayment.findFirst({
      where: {
        id: paymentId,
        userId: request.auth!.userId,
        status: MembershipPaymentStatus.PENDING
      }
    });

    if (!payment) {
      throw new AppError("Pending membership payment not found.", 404, "MEMBERSHIP_PAYMENT_NOT_FOUND");
    }

    if (payment.method === MembershipPaymentMethod.STRIPE && payment.stripeSessionId) {
      await expireStripeMembershipCheckoutSession(payment.stripeSessionId);
    }

    const cancelledPayment = await prisma.membershipPayment.update({
      where: { id: payment.id },
      data: {
        status: MembershipPaymentStatus.CANCELLED,
        notes: "Membership payment cancelled by customer."
      }
    });

    response.json({ payment: serializeMembershipPayment(cancelledPayment) });
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
    const amount = await getMembershipFee(input.tier, input.billingCycle);
    const invoiceNumber = createMembershipInvoiceNumber();
    const expiresAt = new Date(Date.now() + interacInstructionsTtlMs);

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
        interacInstructionsExpiresAt: expiresAt,
        notes: "Interac e-transfer requested. Membership activates after payment is recorded."
      }
    });

    response.status(201).json({
      payment: serializeMembershipPayment(payment),
      instructions: {
        paymentId: payment.id,
        invoiceNumber,
        amount,
        currency: "CAD",
        recipientEmail: interacRecipientEmail,
        expiresAt: expiresAt.toISOString(),
        status: "AWAITING_MANUAL_PAYMENT"
      }
    });
  })
);

membershipsRoutes.post(
  "/memberships/:paymentId/interac-confirm",
  requireRole(["customer"]),
  asyncHandler(async (request, response) => {
    const paymentId = paramValue(request.params.paymentId);
    const payment = await prisma.membershipPayment.findFirst({
      where: {
        id: paymentId,
        userId: request.auth!.userId,
        method: MembershipPaymentMethod.INTERAC,
        status: MembershipPaymentStatus.PENDING
      }
    });

    if (!payment) {
      throw new AppError("E-transfer payment request not found.", 404, "MEMBERSHIP_PAYMENT_NOT_FOUND");
    }

    if (payment.interacInstructionsExpiresAt && payment.interacInstructionsExpiresAt.getTime() < Date.now()) {
      throw new AppError("These e-transfer details have expired. Request new details to continue.", 400, "INTERAC_INSTRUCTIONS_EXPIRED");
    }

    const confirmedAt = new Date();
    const updatedPayment = await prisma.membershipPayment.update({
      where: { id: payment.id },
      data: {
        interacTransferConfirmedAt: confirmedAt,
        notes: `${payment.notes ?? ""}\nCustomer confirmed e-transfer sent at ${confirmedAt.toISOString()}.`.trim()
      }
    });

    response.json({ payment: serializeMembershipPayment(updatedPayment) });
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
            membershipHourlyRate: true,
            membershipActivatedAt: true,
            membershipExpiresAt: true
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
    const payment = await prisma.membershipPayment.findUnique({
      where: { id: paymentId }
    });

    if (!payment || payment.method !== MembershipPaymentMethod.INTERAC) {
      throw new AppError("Interac membership payment not found.", 404, "MEMBERSHIP_PAYMENT_NOT_FOUND");
    }

    if (payment.status !== MembershipPaymentStatus.PENDING) {
      throw new AppError("This membership payment has already been recorded.", 409, "MEMBERSHIP_PAYMENT_ALREADY_RECORDED");
    }

    if (!payment.interacTransferConfirmedAt) {
      throw new AppError("Wait for the customer to confirm the e-transfer before activating membership.", 409, "INTERAC_TRANSFER_NOT_CONFIRMED");
    }

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
