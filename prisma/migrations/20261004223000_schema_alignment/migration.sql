-- Normalize schema objects previously created by manual production scripts so
-- restored and freshly migrated databases match the Prisma data model.
ALTER TABLE "BlogPost" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "TripExtension" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "TripMessage" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "DriverApplication_criminalCheckInvitedAt_idx"
  ON "DriverApplication"("criminalCheckInvitedAt");
CREATE INDEX IF NOT EXISTS "MembershipPayment_interacInstructionsExpiresAt_idx"
  ON "MembershipPayment"("interacInstructionsExpiresAt");
CREATE INDEX IF NOT EXISTS "Payment_interacInstructionsExpiresAt_idx"
  ON "Payment"("interacInstructionsExpiresAt");

-- Earlier manual scripts used partial unique indexes. PostgreSQL unique indexes
-- already permit multiple NULL values, so standard indexes preserve behavior
-- while matching Prisma's @unique representation.
DROP INDEX IF EXISTS "Payment_stripeCheckoutSessionId_key";
DROP INDEX IF EXISTS "Payment_stripePaymentIntentId_key";
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key"
  ON "Payment"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key"
  ON "Payment"("stripePaymentIntentId");
