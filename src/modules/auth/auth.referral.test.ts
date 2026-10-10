import { AccountStatus, ReferralPartnerStatus, ReferralUserType, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { createVerifiedCustomer } from "./auth.service.js";

const createdCustomer = {
  id: "customer-user-1",
  fullName: "Customer One",
  email: "customer@example.com",
  phone: null,
  passwordHash: "stored-hash",
  role: UserRole.CUSTOMER,
  status: AccountStatus.ACTIVE,
  emailVerifiedAt: new Date(),
  membershipTier: "BASIC" as const,
  membershipStatus: "ACTIVE" as const,
  membershipBillingCycle: "NONE" as const,
  membershipHourlyRate: null,
  membershipActivatedAt: null,
  membershipExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

afterEach(() => vi.restoreAllMocks());

describe("verified customer referral registration", () => {
  it("creates the normal customer profile and attributes the verified referral", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.user, "create").mockResolvedValue(createdCustomer);
    vi.spyOn(prisma.referralPartner, "findUnique").mockResolvedValue({
      id: "partner-1",
      name: "Acme",
      contactName: "Partner",
      email: "partner@example.com",
      phone: null,
      code: "CHX-ACM001",
      status: ReferralPartnerStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    vi.spyOn(prisma.referralAttribution, "findUnique").mockResolvedValue(null);
    const createAttribution = vi.spyOn(prisma.referralAttribution, "create").mockResolvedValue({
      id: "attribution-1",
      partnerId: "partner-1",
      userId: createdCustomer.id,
      userType: ReferralUserType.CUSTOMER,
      referralCode: "CHX-ACM001",
      registeredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await createVerifiedCustomer({
      fullName: createdCustomer.fullName,
      email: createdCustomer.email,
      passwordHash: createdCustomer.passwordHash,
      referralCode: "CHX-ACM001"
    });

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: UserRole.CUSTOMER,
        status: AccountStatus.ACTIVE,
        customerProfile: { create: { savedAddresses: [] } }
      })
    }));
    expect(createAttribution).toHaveBeenCalledWith({
      data: {
        partnerId: "partner-1",
        userId: createdCustomer.id,
        userType: ReferralUserType.CUSTOMER,
        referralCode: "CHX-ACM001"
      }
    });
  });

  it("keeps the existing non-referral registration flow unchanged", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.user, "create").mockResolvedValue(createdCustomer);
    const partnerLookup = vi.spyOn(prisma.referralPartner, "findUnique");

    await createVerifiedCustomer({
      fullName: createdCustomer.fullName,
      email: createdCustomer.email,
      passwordHash: createdCustomer.passwordHash
    });

    expect(partnerLookup).not.toHaveBeenCalled();
  });
});
