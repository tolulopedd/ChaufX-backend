-- Payment authorization and delayed capture lifecycle.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CAPTURED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZATION_RELEASED';

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "authorizedAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "capturedAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "authorizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "authorizationReleasedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripeCheckoutSessionId_key"
  ON "Payment"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripePaymentIntentId_key"
  ON "Payment"("stripePaymentIntentId");

-- Driver arrival and live trip stops.
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMP(3);
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_STOP_UPDATED';

CREATE TABLE IF NOT EXISTS "TripStop" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "originLabel" TEXT,
  "originLat" DOUBLE PRECISION,
  "originLng" DOUBLE PRECISION,
  "destinationLabel" TEXT NOT NULL,
  "destinationLat" DOUBLE PRECISION NOT NULL,
  "destinationLng" DOUBLE PRECISION NOT NULL,
  "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripStop_tripId_sequence_key" UNIQUE ("tripId", "sequence"),
  CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TripStop_tripId_completedAt_idx"
  ON "TripStop"("tripId", "completedAt");

-- Paid trip extensions and automatic trip completion.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_EXTENSION_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_EXTENDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_AUTO_ENDED';

DO $$
BEGIN
  CREATE TYPE "TripExtensionStatus" AS ENUM ('PENDING', 'RECORDED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "extensionReminderSentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "TripExtension" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "addedDurationMinutes" INTEGER NOT NULL,
  "hourlyRate" DOUBLE PRECISION NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "status" "TripExtensionStatus" NOT NULL DEFAULT 'PENDING',
  "providerReference" TEXT,
  "recordedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripExtension_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripExtension_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TripExtension_providerReference_key"
  ON "TripExtension"("providerReference");
CREATE INDEX IF NOT EXISTS "TripExtension_bookingId_status_idx"
  ON "TripExtension"("bookingId", "status");

-- Carry unpaid overtime into a later booking when needed.
DO $$
BEGIN
  CREATE TYPE "CustomerOverageChargeStatus" AS ENUM ('PENDING', 'APPLIED', 'WAIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "bookedHourlyRate" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "CustomerOverageCharge" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "sourceBookingId" TEXT NOT NULL,
  "appliedToBookingId" TEXT,
  "overtimeMinutes" INTEGER NOT NULL,
  "billedHours" INTEGER NOT NULL,
  "hourlyRate" DOUBLE PRECISION NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" "CustomerOverageChargeStatus" NOT NULL DEFAULT 'PENDING',
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerOverageCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerOverageCharge_sourceBookingId_key" UNIQUE ("sourceBookingId"),
  CONSTRAINT "CustomerOverageCharge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerOverageCharge_sourceBookingId_fkey" FOREIGN KEY ("sourceBookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerOverageCharge_appliedToBookingId_fkey" FOREIGN KEY ("appliedToBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CustomerOverageCharge_customerId_status_idx"
  ON "CustomerOverageCharge"("customerId", "status");
CREATE INDEX IF NOT EXISTS "CustomerOverageCharge_appliedToBookingId_idx"
  ON "CustomerOverageCharge"("appliedToBookingId");
