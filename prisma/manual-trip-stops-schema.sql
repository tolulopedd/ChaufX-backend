ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_STOP_UPDATED';

CREATE TABLE IF NOT EXISTS "TripStop" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "originLabel" TEXT,
  "originLat" DOUBLE PRECISION,
  "originLng" DOUBLE PRECISION,
  "destinationLabel" TEXT NOT NULL,
  "destinationLat" DOUBLE PRECISION NOT NULL,
  "destinationLng" DOUBLE PRECISION NOT NULL,
  "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripStop_tripId_sequence_key" UNIQUE ("tripId", "sequence"),
  CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TripStop_tripId_completedAt_idx"
ON "TripStop"("tripId", "completedAt");
