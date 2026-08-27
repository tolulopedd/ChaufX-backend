ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_MESSAGE';

CREATE TABLE IF NOT EXISTS "TripMessage" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "senderUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripMessage_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TripMessage_bookingId_fkey'
  ) THEN
    ALTER TABLE "TripMessage"
      ADD CONSTRAINT "TripMessage_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TripMessage_senderUserId_fkey'
  ) THEN
    ALTER TABLE "TripMessage"
      ADD CONSTRAINT "TripMessage_senderUserId_fkey"
      FOREIGN KEY ("senderUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TripMessage_bookingId_createdAt_idx" ON "TripMessage"("bookingId", "createdAt");
CREATE INDEX IF NOT EXISTS "TripMessage_senderUserId_createdAt_idx" ON "TripMessage"("senderUserId", "createdAt");
