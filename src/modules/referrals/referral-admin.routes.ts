import {
  DriverApplicationStatus,
  Prisma,
  ReferralPartnerStatus,
  ReferralUserType
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { env } from "../../config/env.js";
import { createAuditLog } from "../../lib/audit.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import {
  driverReferralStatus,
  generateUniquePartnerCode,
  validateReferralCode
} from "./referral.service.js";

const partnerInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  phone: z.string().trim().min(7).max(30).optional().nullable(),
  code: z.string().trim().transform(validateReferralCode).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional()
});

const partnerUpdateSchema = partnerInputSchema.partial().refine((input) => Object.keys(input).length > 0, {
  message: "At least one partner field is required."
});

function referralLinks(code: string) {
  const customer = new URL(`/ref/customer/${code}`, env.CLIENT_APP_URL).toString();
  const driver = new URL(`/ref/driver/${code}`, env.CLIENT_APP_URL).toString();
  return { customer, driver };
}

function firstCompletedAt(bookings: Array<{ completedAt: Date | null }>) {
  return bookings[0]?.completedAt ?? null;
}

const referralUserSelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  applications: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { status: true }
  },
  customerProfile: {
    select: {
      bookings: {
        where: { status: "COMPLETED" as const },
        orderBy: { completedAt: "asc" as const },
        take: 1,
        select: { completedAt: true }
      }
    }
  },
  driver: {
    select: {
      bookings: {
        where: { status: "COMPLETED" as const },
        orderBy: { completedAt: "asc" as const },
        take: 1,
        select: { completedAt: true }
      }
    }
  }
} satisfies Prisma.UserSelect;

export const referralAdminRoutes = Router();

referralAdminRoutes.use(requireAuth, requireRole(["admin"]));

referralAdminRoutes.get(
  "/admin/referral-partners",
  asyncHandler(async (_request, response) => {
    const [totalPartners, activePartners, customersRegistered, driversRegistered, approvedDrivers, partners] =
      await Promise.all([
        prisma.referralPartner.count(),
        prisma.referralPartner.count({ where: { status: ReferralPartnerStatus.ACTIVE } }),
        prisma.referralAttribution.count({ where: { userType: ReferralUserType.CUSTOMER } }),
        prisma.referralAttribution.count({ where: { userType: ReferralUserType.DRIVER } }),
        prisma.referralAttribution.count({
          where: {
            userType: ReferralUserType.DRIVER,
            user: { applications: { some: { status: DriverApplicationStatus.APPROVED } } }
          }
        }),
        prisma.referralPartner.findMany({
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          include: {
            referrals: {
              select: { userType: true, user: { select: referralUserSelect } }
            }
          }
        })
      ]);

    response.json({
      summary: { totalPartners, activePartners, customersRegistered, driversRegistered, approvedDrivers },
      partners: partners.map((partner) => {
        const customerReferrals = partner.referrals.filter((referral) => referral.userType === ReferralUserType.CUSTOMER);
        const driverReferrals = partner.referrals.filter((referral) => referral.userType === ReferralUserType.DRIVER);
        return {
          id: partner.id,
          name: partner.name,
          contactName: partner.contactName,
          email: partner.email,
          phone: partner.phone,
          code: partner.code,
          status: partner.status,
          createdAt: partner.createdAt,
          updatedAt: partner.updatedAt,
          links: referralLinks(partner.code),
          performance: {
            customersRegistered: customerReferrals.length,
            driversRegistered: driverReferrals.length,
            driversApproved: driverReferrals.filter(
              (referral) => driverReferralStatus(referral.user.applications[0]?.status) === "APPROVED"
            ).length,
            customerFirstTrips: customerReferrals.filter(
              (referral) => firstCompletedAt(referral.user.customerProfile?.bookings ?? [])
            ).length,
            driverFirstTrips: driverReferrals.filter(
              (referral) => firstCompletedAt(referral.user.driver?.bookings ?? [])
            ).length
          }
        };
      })
    });
  })
);

referralAdminRoutes.post(
  "/admin/referral-partners",
  asyncHandler(async (request, response) => {
    const input = partnerInputSchema.parse(request.body);
    const code = input.code ?? (await generateUniquePartnerCode(input.name));

    const existing = await prisma.referralPartner.findUnique({ where: { code }, select: { id: true } });
    if (existing) throw new AppError("Partner code is already in use.", 409, "PARTNER_CODE_EXISTS");

    const partner = await prisma.referralPartner.create({
      data: {
        name: input.name,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone || null,
        code,
        status: input.status ?? ReferralPartnerStatus.ACTIVE
      }
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "REFERRAL_PARTNER_CREATED",
      entityType: "ReferralPartner",
      entityId: partner.id,
      details: { code: partner.code }
    });

    response.status(201).json({ partner: { ...partner, links: referralLinks(partner.code) } });
  })
);

referralAdminRoutes.patch(
  "/admin/referral-partners/:partnerId",
  asyncHandler(async (request, response) => {
    const partnerId = paramValue(request.params.partnerId);
    const input = partnerUpdateSchema.parse(request.body);
    const current = await prisma.referralPartner.findUnique({
      where: { id: partnerId },
      include: { _count: { select: { referrals: true } } }
    });
    if (!current) throw new AppError("Referral partner was not found.", 404, "PARTNER_NOT_FOUND");

    if (input.code && input.code !== current.code && current._count.referrals > 0) {
      throw new AppError("Partner code cannot change after referrals have registered.", 409, "PARTNER_CODE_LOCKED");
    }

    if (input.code && input.code !== current.code) {
      const duplicate = await prisma.referralPartner.findUnique({ where: { code: input.code }, select: { id: true } });
      if (duplicate) throw new AppError("Partner code is already in use.", 409, "PARTNER_CODE_EXISTS");
    }

    const partner = await prisma.referralPartner.update({
      where: { id: partnerId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      }
    });

    await createAuditLog({
      actorId: request.auth!.userId,
      action: "REFERRAL_PARTNER_UPDATED",
      entityType: "ReferralPartner",
      entityId: partner.id,
      details: { fields: Object.keys(input) }
    });

    response.json({ partner: { ...partner, links: referralLinks(partner.code) } });
  })
);

referralAdminRoutes.get(
  "/admin/referral-partners/:partnerId/referrals",
  asyncHandler(async (request, response) => {
    const partnerId = paramValue(request.params.partnerId);
    const query = z
      .object({
        userType: z.enum(["CUSTOMER", "DRIVER"]).optional(),
        status: z.string().trim().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional()
      })
      .parse(request.query);

    const partner = await prisma.referralPartner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new AppError("Referral partner was not found.", 404, "PARTNER_NOT_FOUND");

    const registeredAt = query.from || query.to ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } : undefined;
    const referrals = await prisma.referralAttribution.findMany({
      where: {
        partnerId,
        ...(query.userType ? { userType: query.userType } : {}),
        ...(registeredAt ? { registeredAt } : {})
      },
      orderBy: { registeredAt: "desc" },
      take: 500,
      include: { user: { select: referralUserSelect } }
    });

    const formatted = referrals.map((referral) => {
      const applicationStatus = referral.user.applications[0]?.status;
      const status =
        referral.userType === ReferralUserType.DRIVER
          ? driverReferralStatus(applicationStatus)
          : referral.user.status;
      const firstCompletedTripAt =
        referral.userType === ReferralUserType.DRIVER
          ? firstCompletedAt(referral.user.driver?.bookings ?? [])
          : firstCompletedAt(referral.user.customerProfile?.bookings ?? []);
      return {
        id: referral.id,
        userId: referral.userId,
        userType: referral.userType,
        registeredAt: referral.registeredAt,
        referralCode: referral.referralCode,
        status,
        firstCompletedTripAt,
        user: {
          fullName: referral.user.fullName,
          email: referral.user.email,
          phone: referral.user.phone
        }
      };
    });

    const requestedStatus = query.status?.toUpperCase();
    response.json({
      partner: { ...partner, links: referralLinks(partner.code) },
      referrals: requestedStatus ? formatted.filter((referral) => referral.status === requestedStatus) : formatted
    });
  })
);
