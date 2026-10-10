import { randomInt } from "node:crypto";
import { DriverApplicationStatus, Prisma, ReferralPartnerStatus, ReferralUserType } from "@prisma/client";
import { AppError } from "../../common/AppError.js";
import { prisma } from "../../lib/prisma.js";

export const REFERRAL_CODE_PATTERN = /^CHX-[A-Z0-9]{3,12}$/;

export function normalizeReferralCode(value: string) {
  return value.trim().toUpperCase();
}

export function validateReferralCode(value: string) {
  const code = normalizeReferralCode(value);
  if (!REFERRAL_CODE_PATTERN.test(code)) {
    throw new AppError("Referral code is invalid.", 400, "INVALID_REFERRAL_CODE");
  }
  return code;
}

export function buildPartnerCodeCandidate(partnerName: string, suffix = randomInt(0, 1000)) {
  const prefix = partnerName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X");
  return `CHX-${prefix}${suffix.toString().padStart(3, "0")}`;
}

export async function generateUniquePartnerCode(partnerName: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = buildPartnerCodeCandidate(partnerName);
    const existing = await prisma.referralPartner.findUnique({ where: { code }, select: { id: true } });
    if (!existing) return code;
  }

  throw new AppError("Unable to generate a unique partner code. Please try again.", 503, "REFERRAL_CODE_UNAVAILABLE");
}

export async function requireActiveReferralPartner(rawCode: string) {
  const code = validateReferralCode(rawCode);
  const partner = await prisma.referralPartner.findUnique({ where: { code } });

  if (!partner || partner.status !== ReferralPartnerStatus.ACTIVE) {
    throw new AppError("Referral code is invalid or inactive.", 400, "INVALID_REFERRAL_CODE");
  }

  return partner;
}

export async function attributeUserToPartner(params: {
  userId: string;
  userType: ReferralUserType;
  referralCode?: string | null;
}) {
  if (!params.referralCode) return null;

  const partner = await requireActiveReferralPartner(params.referralCode);
  const existing = await prisma.referralAttribution.findUnique({ where: { userId: params.userId } });

  if (existing) {
    if (existing.partnerId !== partner.id || existing.userType !== params.userType) {
      throw new AppError("This account already has a referral partner.", 409, "REFERRAL_ALREADY_ATTRIBUTED");
    }
    return existing;
  }

  try {
    return await prisma.referralAttribution.create({
      data: {
        partnerId: partner.id,
        userId: params.userId,
        userType: params.userType,
        referralCode: partner.code
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.referralAttribution.findUnique({ where: { userId: params.userId } });
      if (concurrent?.partnerId === partner.id && concurrent.userType === params.userType) return concurrent;
      throw new AppError("This account already has a referral partner.", 409, "REFERRAL_ALREADY_ATTRIBUTED");
    }
    throw error;
  }
}

export function driverReferralStatus(status?: DriverApplicationStatus | null) {
  if (status === DriverApplicationStatus.APPROVED) return "APPROVED" as const;
  if (status === DriverApplicationStatus.REJECTED) return "REJECTED" as const;
  return "PENDING" as const;
}
