import { describe, expect, it } from "vitest";
import { safeCheckoutReturnUrl } from "./checkout-return-url.js";

describe("safeCheckoutReturnUrl", () => {
  const fallback = "https://chaufx.ca/payment-complete";
  const client = "https://chaufx.ca";

  it("allows the configured web client", () => {
    expect(safeCheckoutReturnUrl("https://chaufx.ca/customer#upcoming", fallback, client).toString())
      .toBe("https://chaufx.ca/customer#upcoming");
  });

  it("allows the registered customer app scheme", () => {
    expect(safeCheckoutReturnUrl("ca.chaufx.customer://payment-complete", fallback, client).toString())
      .toBe("ca.chaufx.customer://payment-complete");
  });

  it("rejects external and malformed redirects", () => {
    expect(safeCheckoutReturnUrl("https://example.com/phishing", fallback, client).toString())
      .toBe(fallback);
    expect(safeCheckoutReturnUrl("not a url", fallback, client).toString()).toBe(fallback);
  });
});
