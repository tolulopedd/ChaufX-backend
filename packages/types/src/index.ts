export type UserRole = "customer" | "driver" | "admin";

export type BookingStatus = "pending" | "accepted" | "enroute" | "active" | "completed" | "cancelled";

export type TripStatus = "scheduled" | "active" | "completed" | "cancelled";

export type DriverApplicationStatus = "submitted" | "under_review" | "approved" | "rejected";

export type PaymentStatus = "pending" | "recorded" | "failed" | "refunded";

export type NotificationType =
  | "booking_submitted"
  | "driver_accepted"
  | "driver_arrived"
  | "trip_started"
  | "trip_completed"
  | "upcoming_trip"
  | "application_reviewed";

export interface UserSummary {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  role: UserRole;
}

export interface VehicleSummary {
  id: string;
  make: string;
  model: string;
  plateNumber: string;
  color?: string | null;
}

export interface DriverSummary {
  id: string;
  userId: string;
  fullName: string;
  phone?: string | null;
  email: string;
  availabilityStatus: boolean;
  serviceAreas: string[];
  yearsOfExperience: number;
  ratingAverage?: number | null;
}

export interface BookingSummary {
  id: string;
  status: BookingStatus;
  pickupLocation: string;
  destinationLocation: string;
  scheduledStartAt: string;
  expectedDurationMinutes: number;
  specialNotes?: string | null;
  vehicleDetails?: string | null;
  driver?: DriverSummary | null;
}

export interface LocationPoint {
  latitude: number;
  longitude: number;
  heading?: number | null;
  recordedAt: string;
}

export interface TripMapState {
  bookingId: string;
  active: boolean;
  canNavigate: boolean;
  activationStartsAt: string;
  activationEndsAt: string;
  reason?: string;
  latestDriverLocation?: LocationPoint | null;
}

export interface DriverApplicationSummary {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: DriverApplicationStatus;
  preferredServiceAreas: string[];
  createdAt: string;
}

export interface DashboardMetric {
  label: string;
  value: string;
  hint: string;
}
