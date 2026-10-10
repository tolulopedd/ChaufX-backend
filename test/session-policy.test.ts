import { describe, expect, it } from "vitest";
import { refreshTokenTtlDays } from "../src/lib/auth.js";

describe("mobile session policy", () => {
  it("keeps driver refresh credentials longer lived than normal web credentials", () => {
    expect(refreshTokenTtlDays("driver")).toBeGreaterThan(refreshTokenTtlDays("admin"));
  });

  it("supports persistent customer session restoration", () => {
    expect(refreshTokenTtlDays("customer")).toBeGreaterThanOrEqual(30);
  });
});
