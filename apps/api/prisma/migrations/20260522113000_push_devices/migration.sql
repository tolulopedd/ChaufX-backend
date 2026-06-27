-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVariant" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_expoPushToken_key" ON "PushDevice"("expoPushToken");

-- CreateIndex
CREATE INDEX "PushDevice_userId_disabledAt_idx" ON "PushDevice"("userId", "disabledAt");

-- CreateIndex
CREATE INDEX "PushDevice_expoPushToken_disabledAt_idx" ON "PushDevice"("expoPushToken", "disabledAt");

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
