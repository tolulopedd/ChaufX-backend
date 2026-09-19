ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "interacInstructionsExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "interacTransferConfirmedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Payment_interacInstructionsExpiresAt_idx"
  ON "Payment"("interacInstructionsExpiresAt");
