import { describe, expect, it } from "vitest";
import { isEligibleCustomerAge } from "../src/lib/customer-age.js";

const reviewDate = new Date("2026-09-04T12:00:00.000Z");

describe("customer minimum age", () => {
  it("allows a customer who is exactly 18", () => {
    expect(isEligibleCustomerAge(new Date("2008-09-04T12:00:00.000Z"), reviewDate)).toBe(true);
  });

  it("blocks a customer who has not reached 18", () => {
    expect(isEligibleCustomerAge(new Date("2008-09-05T12:00:00.000Z"), reviewDate)).toBe(false);
  });
});
