import { describe, expect, it } from "vitest";
import { hasCompleteCustomerBookingProfile } from "../src/modules/bookings/bookings.routes.js";

const completeCustomer = {
  emailVerifiedAt: new Date("2026-09-03T12:00:00.000Z"),
  phone: "+12045550123",
  customerProfile: {
    identityDocument: { id: "identity_document" },
    vehicles: [
      {
        make: "Toyota",
        model: "Highlander",
        plateNumber: "ABC123",
        registrationProvince: "Manitoba"
      }
    ]
  }
};

describe("customer booking verification", () => {
  it("allows a verified customer with phone, ID, and a complete primary vehicle", () => {
    expect(hasCompleteCustomerBookingProfile(completeCustomer)).toBe(true);
  });

  it.each([
    ["an unverified email", { ...completeCustomer, emailVerifiedAt: null }],
    ["no mobile phone", { ...completeCustomer, phone: null }],
    ["no identity document", { ...completeCustomer, customerProfile: { ...completeCustomer.customerProfile, identityDocument: null } }],
    [
      "an incomplete vehicle",
      {
        ...completeCustomer,
        customerProfile: {
          ...completeCustomer.customerProfile,
          vehicles: [{ ...completeCustomer.customerProfile.vehicles[0], registrationProvince: "" }]
        }
      }
    ]
  ])("blocks booking for %s", (_reason, customer) => {
    expect(hasCompleteCustomerBookingProfile(customer)).toBe(false);
  });
});
