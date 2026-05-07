import type { BookingStatus, DriverApplicationStatus } from "@chaufx/types";

export const brand = {
  name: "ChaufX",
  accent: "#4f46e5",
  accentDeep: "#4338ca",
  accentSoft: "#eef0ff",
  ink: "#0f172a",
  muted: "#64748b",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#dc2626"
} as const;

export function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function bookingStatusTone(status: BookingStatus) {
  switch (status) {
    case "completed":
      return { text: "Completed", color: brand.success };
    case "active":
      return { text: "Active", color: brand.accent };
    case "accepted":
      return { text: "Accepted", color: brand.accentDeep };
    case "enroute":
      return { text: "En route", color: brand.warning };
    case "cancelled":
      return { text: "Cancelled", color: brand.danger };
    default:
      return { text: "Pending", color: brand.warning };
  }
}

export function applicationStatusTone(status: DriverApplicationStatus) {
  switch (status) {
    case "approved":
      return { text: "Approved", color: brand.success };
    case "rejected":
      return { text: "Rejected", color: brand.danger };
    case "under_review":
      return { text: "Under review", color: brand.warning };
    default:
      return { text: "Submitted", color: brand.accent };
  }
}
