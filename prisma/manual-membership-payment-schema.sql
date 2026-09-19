ALTER TABLE "MembershipPayment"
  ADD COLUMN IF NOT EXISTS "interacInstructionsExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "interacTransferConfirmedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "MembershipPayment_interacInstructionsExpiresAt_idx"
  ON "MembershipPayment"("interacInstructionsExpiresAt");
