import { DriverApplicationStatus, ReferralPartnerStatus, ReferralUserType } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma.js";
import {
  attributeUserToPartner,
  buildPartnerCodeCandidate,
  driverReferralStatus,
  normalizeReferralCode,
  validateReferralCode
} from "./referral.service.js";

const partner = {
  id: "partner-1",
  name: "Acme",
  contactName: "A Partner",
  email: "partner@example.com",
  phone: null,
  code: "CHX-ACM001",
  status: ReferralPartnerStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date()
};

afterEach(() => vi.restoreAllMocks());

describe("partner referral codes", () => {
  it("normalizes and validates codes used by web and mobile registration", () => {
    expect(normalizeReferralCode(" chx-acm001 ")).toBe("CHX-ACM001");
    expect(validateReferralCode("chx-acm001")).toBe("CHX-ACM001");
    expect(buildPartnerCodeCandidate("Acme Group", 7)).toBe("CHX-ACM007");
    expect(() => validateReferralCode("ACME")).toThrowError("Referral code is invalid.");
  });
});

describe("referral attribution", () => {
  it.each([ReferralUserType.CUSTOMER, ReferralUserType.DRIVER])(
    "stores immutable %s registration attribution",
    async (userType) => {
      vi.spyOn(prisma.referralPartner, "findUnique").mockResolvedValue(partner);
      vi.spyOn(prisma.referralAttribution, "findUnique").mockResolvedValue(null);
      const create = vi.spyOn(prisma.referralAttribution, "create").mockResolvedValue({
        id: "referral-1",
        partnerId: partner.id,
        userId: "user-1",
        userType,
        referralCode: partner.code,
        registeredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await attributeUserToPartner({ userId: "user-1", userType, referralCode: "chx-acm001" });

      expect(create).toHaveBeenCalledWith({
        data: { partnerId: partner.id, userId: "user-1", userType, referralCode: partner.code }
      });
    }
  );

  it("does not create a duplicate when the same attribution is submitted again", async () => {
    vi.spyOn(prisma.referralPartner, "findUnique").mockResolvedValue(partner);
    vi.spyOn(prisma.referralAttribution, "findUnique").mockResolvedValue({
      id: "referral-1",
      partnerId: partner.id,
      userId: "user-1",
      userType: ReferralUserType.CUSTOMER,
      referralCode: partner.code,
      registeredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const create = vi.spyOn(prisma.referralAttribution, "create");

    await attributeUserToPartner({ userId: "user-1", userType: ReferralUserType.CUSTOMER, referralCode: partner.code });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects attempted re-attribution to a different partner", async () => {
    vi.spyOn(prisma.referralPartner, "findUnique").mockResolvedValue(partner);
    vi.spyOn(prisma.referralAttribution, "findUnique").mockResolvedValue({
      id: "referral-1",
      partnerId: "another-partner",
      userId: "user-1",
      userType: ReferralUserType.CUSTOMER,
      referralCode: "CHX-OLD001",
      registeredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await expect(
      attributeUserToPartner({ userId: "user-1", userType: ReferralUserType.CUSTOMER, referralCode: partner.code })
    ).rejects.toMatchObject({ code: "REFERRAL_ALREADY_ATTRIBUTED", statusCode: 409 });
  });
});

describe("driver approval referral status", () => {
  it("follows the existing approval states without bypassing them", () => {
    expect(driverReferralStatus(DriverApplicationStatus.SUBMITTED)).toBe("PENDING");
    expect(driverReferralStatus(DriverApplicationStatus.UNDER_REVIEW)).toBe("PENDING");
    expect(driverReferralStatus(DriverApplicationStatus.APPROVED)).toBe("APPROVED");
    expect(driverReferralStatus(DriverApplicationStatus.REJECTED)).toBe("REJECTED");
  });
});
