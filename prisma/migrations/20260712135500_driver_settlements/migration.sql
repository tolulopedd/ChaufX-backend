-- CreateEnum
CREATE TYPE "DriverSettlementStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "DriverSettlement" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "status" "DriverSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "platformSharePercent" DOUBLE PRECISION NOT NULL,
    "platformShareAmount" DOUBLE PRECISION NOT NULL,
    "driverShareAmount" DOUBLE PRECISION NOT NULL,
    "tripCount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "payoutReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverSettlement_driverId_weekStart_key" ON "DriverSettlement"("driverId", "weekStart");

-- CreateIndex
CREATE INDEX "DriverSettlement_status_weekStart_idx" ON "DriverSettlement"("status", "weekStart");

-- CreateIndex
CREATE INDEX "DriverSettlement_driverId_weekStart_idx" ON "DriverSettlement"("driverId", "weekStart");

-- AddForeignKey
ALTER TABLE "DriverSettlement" ADD CONSTRAINT "DriverSettlement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
