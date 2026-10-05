DO $$
BEGIN
  CREATE TYPE "CustomerOverageChargeStatus" AS ENUM ('PENDING', 'APPLIED', 'WAIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "bookedHourlyRate" DOUBLE PRECISION;

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
