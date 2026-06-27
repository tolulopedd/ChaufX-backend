-- CreateIndex
CREATE INDEX "Booking_status_scheduledStartAt_idx" ON "Booking"("status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "Booking_assignedDriverId_status_idx" ON "Booking"("assignedDriverId", "status");
