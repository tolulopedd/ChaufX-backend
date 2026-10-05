ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_EXTENSION_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_EXTENDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_AUTO_ENDED';

DO $$
BEGIN
  CREATE TYPE "TripExtensionStatus" AS ENUM ('PENDING', 'RECORDED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Trip"
  ADD COLUMN IF NOT EXISTS "extensionReminderSentAt" TIMESTAMP(3);

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

CREATE UNIQUE INDEX IF NOT EXISTS "TripExtension_providerReference_key" ON "TripExtension"("providerReference");
CREATE INDEX IF NOT EXISTS "TripExtension_bookingId_status_idx" ON "TripExtension"("bookingId", "status");
