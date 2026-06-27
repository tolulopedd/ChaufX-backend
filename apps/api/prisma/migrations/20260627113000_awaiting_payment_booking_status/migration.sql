ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";

CREATE TYPE "BookingStatus" AS ENUM (
  'AWAITING_PAYMENT',
  'PENDING',
  'ACCEPTED',
  'ENROUTE',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "Booking"
ALTER COLUMN "status" DROP DEFAULT,
ADD COLUMN "status_next" "BookingStatus";

UPDATE "Booking" AS b
SET "status_next" = CASE
  WHEN b."status"::text = 'PENDING'
    AND b."assignedDriverId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "Payment" AS p
      WHERE p."bookingId" = b."id"
        AND p."status" = 'RECORDED'
    )
    THEN 'AWAITING_PAYMENT'::"BookingStatus"
  ELSE b."status"::text::"BookingStatus"
END;

ALTER TABLE "Booking"
DROP COLUMN "status",
ADD COLUMN "status_old_text" TEXT;

UPDATE "Booking"
SET "status_old_text" = "status_next"::text;

ALTER TABLE "Booking"
DROP COLUMN "status_next";

ALTER TABLE "Booking"
ADD COLUMN "status" "BookingStatus";

UPDATE "Booking"
SET "status" = "status_old_text"::"BookingStatus";

ALTER TABLE "Booking"
DROP COLUMN "status_old_text";

ALTER TABLE "Booking"
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'AWAITING_PAYMENT';

DROP TYPE "BookingStatus_old";
