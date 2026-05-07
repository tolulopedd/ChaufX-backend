export const apiDocs = {
  name: "ChaufX API",
  version: "0.1.0",
  modules: [
    "auth",
    "users",
    "drivers",
    "driver-onboarding",
    "bookings",
    "trips",
    "locations",
    "payments",
    "notifications",
    "admin"
  ],
  notes: [
    "Maps and live tracking activate only after booking acceptance and during the configured trip window.",
    "Driver access is blocked until onboarding approval.",
    "Auth endpoints are rate limited."
  ]
};
