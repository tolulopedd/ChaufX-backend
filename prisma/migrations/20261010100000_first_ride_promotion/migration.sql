CREATE TYPE "PromotionDiscountType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');
CREATE TYPE "FirstRidePromotionRedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED', 'RELEASED');

CREATE TABLE "FirstRidePromotionConfig" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "discountType" "PromotionDiscountType" NOT NULL DEFAULT 'FIXED_AMOUNT',
  "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxDiscountAmount" DOUBLE PRECISION,
  "minimumBookingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "usageLimit" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleMembershipTiers" "MembershipTier"[] NOT NULL DEFAULT ARRAY[]::"MembershipTier"[],
  "combineWithMembershipRates" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FirstRidePromotionConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirstRidePromotionRedemption" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "status" "FirstRidePromotionRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
  "originalFare" DOUBLE PRECISION NOT NULL,
  "discountAmount" DOUBLE PRECISION NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "redeemedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FirstRidePromotionRedemption_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerProfile" ADD COLUMN "firstRidePromotionReservedId" TEXT;
ALTER TABLE "CustomerProfile" ADD COLUMN "firstRidePromotionRedeemedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "promotionOriginalFare" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "promotionDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "CustomerProfile_firstRidePromotionReservedId_key" ON "CustomerProfile"("firstRidePromotionReservedId");
CREATE UNIQUE INDEX "FirstRidePromotionRedemption_bookingId_key" ON "FirstRidePromotionRedemption"("bookingId");
CREATE INDEX "FirstRidePromotionRedemption_customerId_status_idx" ON "FirstRidePromotionRedemption"("customerId", "status");
CREATE INDEX "FirstRidePromotionRedemption_configId_status_idx" ON "FirstRidePromotionRedemption"("configId", "status");

ALTER TABLE "FirstRidePromotionRedemption" ADD CONSTRAINT "FirstRidePromotionRedemption_configId_fkey" FOREIGN KEY ("configId") REFERENCES "FirstRidePromotionConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FirstRidePromotionRedemption" ADD CONSTRAINT "FirstRidePromotionRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FirstRidePromotionRedemption" ADD CONSTRAINT "FirstRidePromotionRedemption_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
