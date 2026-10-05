ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CAPTURED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZATION_RELEASED';

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "authorizedAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "capturedAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "authorizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "authorizationReleasedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripeCheckoutSessionId_key"
  ON "Payment"("stripeCheckoutSessionId")
  WHERE "stripeCheckoutSessionId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_stripePaymentIntentId_key"
  ON "Payment"("stripePaymentIntentId")
  WHERE "stripePaymentIntentId" IS NOT NULL;
