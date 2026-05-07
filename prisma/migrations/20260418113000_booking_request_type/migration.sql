DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingRequestType') THEN
    CREATE TYPE "BookingRequestType" AS ENUM ('NOW', 'LATER');
  END IF;
END $$;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "requestType" "BookingRequestType" NOT NULL DEFAULT 'NOW';
