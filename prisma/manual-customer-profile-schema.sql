ALTER TABLE "CustomerProfile"
  ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "primaryAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactName" TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicleRegistrationProvince" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicleComplianceConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "privacyPolicyAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "identityVerificationConsentedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vehicleAuthorityConfirmedAt" TIMESTAMP(3);

ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "registrationProvince" TEXT,
  ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CustomerIdentityDocument" (
  "id" TEXT NOT NULL,
  "customerProfileId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "mimeType" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerIdentityDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerIdentityDocument_customerProfileId_key"
  ON "CustomerIdentityDocument"("customerProfileId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CustomerIdentityDocument_customerProfileId_fkey'
  ) THEN
    ALTER TABLE "CustomerIdentityDocument"
      ADD CONSTRAINT "CustomerIdentityDocument_customerProfileId_fkey"
      FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
