ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "preferredDriverId" TEXT;

CREATE INDEX IF NOT EXISTS "Booking_preferredDriverId_idx"
  ON "Booking"("preferredDriverId");

DO $$ BEGIN
  ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_preferredDriverId_fkey"
    FOREIGN KEY ("preferredDriverId") REFERENCES "Driver"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
