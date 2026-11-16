-- Guest bookings retain the existing Booking record and workflow while keeping
-- contact, attribution and secure-access data separate from account records.
CREATE TABLE "GuestBooking" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "claimedByUserId" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmTerm" TEXT,
  "utmContent" TEXT,
  "landingPath" TEXT,
  "setupConsentAt" TIMESTAMP(3),
  "stripeCustomerId" TEXT,
  "stripePaymentMethodId" TEXT,
  "stripeSetupIntentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuestBooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestBooking_bookingId_key" ON "GuestBooking"("bookingId");
CREATE UNIQUE INDEX "GuestBooking_accessTokenHash_key" ON "GuestBooking"("accessTokenHash");
CREATE UNIQUE INDEX "GuestBooking_stripeSetupIntentId_key" ON "GuestBooking"("stripeSetupIntentId");
CREATE INDEX "GuestBooking_email_createdAt_idx" ON "GuestBooking"("email", "createdAt");
CREATE INDEX "GuestBooking_claimedByUserId_idx" ON "GuestBooking"("claimedByUserId");
CREATE INDEX "GuestBooking_utmSource_utmCampaign_idx" ON "GuestBooking"("utmSource", "utmCampaign");
ALTER TABLE "GuestBooking" ADD CONSTRAINT "GuestBooking_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestBooking" ADD CONSTRAINT "GuestBooking_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
