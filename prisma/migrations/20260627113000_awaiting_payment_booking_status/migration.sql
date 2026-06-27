ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';

ALTER TABLE "Booking"
ALTER COLUMN "status" SET DEFAULT 'AWAITING_PAYMENT';

UPDATE "Booking" AS b
SET "status" = 'AWAITING_PAYMENT'
WHERE b."status" = 'PENDING'
  AND b."assignedDriverId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Payment" AS p
    WHERE p."bookingId" = b."id"
      AND p."status" = 'RECORDED'
  );
