ALTER TABLE "DriverApplication"
  ADD COLUMN IF NOT EXISTS "backgroundCheckComment" TEXT,
  ADD COLUMN IF NOT EXISTS "applicantResponse" TEXT,
  ADD COLUMN IF NOT EXISTS "driverAbstractInitiatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "criminalCheckInvitedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "criminalCheckInvitedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "DriverApplication_criminalCheckInvitedAt_idx"
  ON "DriverApplication"("criminalCheckInvitedAt");

ALTER TYPE "EmailVerificationPurpose" ADD VALUE IF NOT EXISTS 'DRIVER_APPLICATION_UPDATE';

DO $$ BEGIN
  CREATE TYPE "DriverApplicationReviewAuthor" AS ENUM ('ADMIN', 'DRIVER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DriverApplicationReviewEvent" AS ENUM (
    'ADDITIONAL_INFORMATION_REQUESTED',
    'APPLICATION_RESUBMITTED',
    'APPROVED',
    'REJECTED',
    'CRIMINAL_CHECK_SENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DriverApplicationReviewHistory" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "author" "DriverApplicationReviewAuthor" NOT NULL,
  "event" "DriverApplicationReviewEvent" NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverApplicationReviewHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverApplicationReviewHistory_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "DriverApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DriverApplicationReviewHistory_applicationId_createdAt_idx"
  ON "DriverApplicationReviewHistory"("applicationId", "createdAt");

INSERT INTO "DriverApplicationReviewHistory" ("id", "applicationId", "author", "event", "note", "createdAt")
SELECT
  gen_random_uuid()::text,
  application."id",
  'ADMIN'::"DriverApplicationReviewAuthor",
  CASE application."status"
    WHEN 'APPROVED' THEN 'APPROVED'::"DriverApplicationReviewEvent"
    WHEN 'REJECTED' THEN 'REJECTED'::"DriverApplicationReviewEvent"
    ELSE 'ADDITIONAL_INFORMATION_REQUESTED'::"DriverApplicationReviewEvent"
  END,
  application."reviewNote",
  COALESCE(application."reviewedAt", application."updatedAt")
FROM "DriverApplication" application
WHERE NULLIF(BTRIM(application."reviewNote"), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "DriverApplicationReviewHistory" history
    WHERE history."applicationId" = application."id"
      AND history."author" = 'ADMIN'::"DriverApplicationReviewAuthor"
      AND history."note" = application."reviewNote"
  );

INSERT INTO "DriverApplicationReviewHistory" ("id", "applicationId", "author", "event", "note", "createdAt")
SELECT
  gen_random_uuid()::text,
  application."id",
  'DRIVER'::"DriverApplicationReviewAuthor",
  'APPLICATION_RESUBMITTED'::"DriverApplicationReviewEvent",
  application."applicantResponse",
  application."updatedAt"
FROM "DriverApplication" application
WHERE NULLIF(BTRIM(application."applicantResponse"), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "DriverApplicationReviewHistory" history
    WHERE history."applicationId" = application."id"
      AND history."author" = 'DRIVER'::"DriverApplicationReviewAuthor"
      AND history."note" = application."applicantResponse"
  );
