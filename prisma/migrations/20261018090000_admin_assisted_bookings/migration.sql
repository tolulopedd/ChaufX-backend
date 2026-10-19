CREATE TYPE "BookingPaymentMethod" AS ENUM ('STRIPE', 'INTERAC');

ALTER TABLE "Booking"
  ADD COLUMN "adminAssistedAt" TIMESTAMP(3),
  ADD COLUMN "adminAssistedByUserId" TEXT;

ALTER TABLE "Payment"
  ADD COLUMN "method" "BookingPaymentMethod" NOT NULL DEFAULT 'STRIPE',
  ADD COLUMN "confirmedByUserId" TEXT,
  ADD COLUMN "confirmedByAdminName" TEXT;

CREATE INDEX "Booking_adminAssistedAt_idx" ON "Booking"("adminAssistedAt");
CREATE INDEX "Payment_method_status_idx" ON "Payment"("method", "status");
