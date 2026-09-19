import { MembershipBillingCycle } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getMembershipExpiresAt } from "../src/modules/memberships/membership.service.js";

describe("getMembershipExpiresAt", () => {
  it("keeps a month-end monthly membership in the next calendar month", () => {
    const expiresAt = getMembershipExpiresAt(new Date(2027, 0, 31, 10, 30), MembershipBillingCycle.MONTHLY);

    expect(expiresAt).toEqual(new Date(2027, 1, 28, 10, 30));
  });

  it("keeps a leap-day annual membership in the next calendar year", () => {
    const expiresAt = getMembershipExpiresAt(new Date(2028, 1, 29, 10, 30), MembershipBillingCycle.ANNUAL);

    expect(expiresAt).toEqual(new Date(2029, 1, 28, 10, 30));
  });
});
