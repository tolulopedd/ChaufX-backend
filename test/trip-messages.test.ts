import { describe, expect, it } from "vitest";
import { containsPersonalContactDetails } from "../src/modules/trip-messages/trip-messages.routes.js";

describe("trip message privacy", () => {
  it.each([
    "Call me at +1 (204) 555-0199",
    "My email is rider@example.com",
    "Message me on WhatsApp",
    "Follow @private_handle",
    "Open https://example.com/chat"
  ])("blocks personal contact details in %j", (message) => {
    expect(containsPersonalContactDetails(message)).toBe(true);
  });

  it.each([
    "I'm outside now.",
    "Please wait by the front entrance.",
    "I will be ready in 5 minutes.",
    "The pickup is at 11 Grey Heron Drive."
  ])("allows trip coordination in %j", (message) => {
    expect(containsPersonalContactDetails(message)).toBe(false);
  });
});
