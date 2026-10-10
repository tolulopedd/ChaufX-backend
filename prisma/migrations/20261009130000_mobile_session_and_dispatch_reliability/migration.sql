-- Preserve existing availability while recording active-app reachability.
ALTER TABLE "Driver" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

-- New offers receive an explicit response deadline. Existing offers remain
-- compatible and are expired by their notifiedAt timestamp in application code.
ALTER TABLE "BookingDispatch" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "BookingDispatch_status_expiresAt_idx" ON "BookingDispatch"("status", "expiresAt");

-- Prevent duplicate pushes for the same logical event and recipient.
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
