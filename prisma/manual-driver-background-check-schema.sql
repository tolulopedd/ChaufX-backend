ALTER TABLE "DriverApplication"
  ADD COLUMN IF NOT EXISTS "backgroundCheckComment" TEXT,
  ADD COLUMN IF NOT EXISTS "applicantResponse" TEXT,
  ADD COLUMN IF NOT EXISTS "driverAbstractInitiatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "criminalCheckInvitedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "criminalCheckInvitedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "DriverApplication_criminalCheckInvitedAt_idx"
  ON "DriverApplication"("criminalCheckInvitedAt");

ALTER TYPE "EmailVerificationPurpose" ADD VALUE IF NOT EXISTS 'DRIVER_APPLICATION_UPDATE';
