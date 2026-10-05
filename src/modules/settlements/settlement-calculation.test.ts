import { describe, expect, it } from "vitest";
import { calculateBookingSettlement } from "./settlement-calculation.js";

describe("calculateBookingSettlement", () => {
  it("includes every recorded trip extension in the driver and platform split", () => {
    expect(
      calculateBookingSettlement(
        {
          fareEstimate: 100,
          payment: { amount: 100, capturedAmount: 100 },
          tripExtensions: [
            { amount: 25, status: "RECORDED" },
            { amount: 25, status: "RECORDED" }
          ]
        },
        30
      )
    ).toEqual({
      baseAmount: 100,
      extensionAmount: 50,
      extensionCount: 2,
      grossAmount: 150,
      platformShareAmount: 45,
      driverShareAmount: 105
    });
  });

  it("does not count pending, failed, or cancelled extensions", () => {
    const result = calculateBookingSettlement(
      {
        fareEstimate: 80,
        payment: { amount: 80 },
        tripExtensions: [
          { amount: 20, status: "PENDING" },
          { amount: 20, status: "FAILED" },
          { amount: 20, status: "CANCELLED" }
        ]
      },
      30
    );

    expect(result.grossAmount).toBe(80);
    expect(result.extensionAmount).toBe(0);
    expect(result.driverShareAmount).toBe(56);
    expect(result.platformShareAmount).toBe(24);
  });

  it("uses the captured base amount and rounds currency to cents", () => {
    const result = calculateBookingSettlement(
      {
        fareEstimate: 50,
        payment: { amount: 50, capturedAmount: 49.99 },
        tripExtensions: [{ amount: 16.67, status: "RECORDED" }]
      },
      30
    );

    expect(result.baseAmount).toBe(49.99);
    expect(result.grossAmount).toBe(66.66);
    expect(result.platformShareAmount).toBe(20);
    expect(result.driverShareAmount).toBe(46.66);
  });
});
