-- CreateEnum
CREATE TYPE "BookingDispatchStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Driver"
ADD COLUMN "currentLatitude" DOUBLE PRECISION,
ADD COLUMN "currentLongitude" DOUBLE PRECISION,
ADD COLUMN "locationUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BookingDispatch" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "status" "BookingDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDispatch_bookingId_driverId_key" ON "BookingDispatch"("bookingId", "driverId");

-- CreateIndex
CREATE INDEX "BookingDispatch_driverId_status_idx" ON "BookingDispatch"("driverId", "status");

-- CreateIndex
CREATE INDEX "BookingDispatch_bookingId_status_idx" ON "BookingDispatch"("bookingId", "status");

-- AddForeignKey
ALTER TABLE "BookingDispatch" ADD CONSTRAINT "BookingDispatch_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDispatch" ADD CONSTRAINT "BookingDispatch_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
