CREATE TYPE "MembershipTier" AS ENUM ('BASIC', 'PLUS', 'CONCIERGE', 'CORPORATE');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED');
CREATE TYPE "MembershipBillingCycle" AS ENUM ('NONE', 'MONTHLY', 'ANNUAL', 'CUSTOM');
CREATE TYPE "MembershipPaymentMethod" AS ENUM ('STRIPE', 'INTERAC');
CREATE TYPE "MembershipPaymentStatus" AS ENUM ('PENDING', 'RECORDED', 'FAILED', 'CANCELLED');

ALTER TABLE "User"
ADD COLUMN "membershipTier" "MembershipTier" NOT NULL DEFAULT 'BASIC',
ADD COLUMN "membershipStatus" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "membershipBillingCycle" "MembershipBillingCycle" NOT NULL DEFAULT 'NONE',
ADD COLUMN "membershipHourlyRate" DOUBLE PRECISION,
ADD COLUMN "membershipActivatedAt" TIMESTAMP(3),
ADD COLUMN "membershipExpiresAt" TIMESTAMP(3);

CREATE TABLE "MembershipPayment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tier" "MembershipTier" NOT NULL,
  "billingCycle" "MembershipBillingCycle" NOT NULL,
  "method" "MembershipPaymentMethod" NOT NULL,
  "status" "MembershipPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "invoiceNumber" TEXT NOT NULL,
  "stripeSessionId" TEXT,
  "interacEmail" TEXT,
  "recordedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MembershipPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipPayment_invoiceNumber_key" ON "MembershipPayment"("invoiceNumber");
CREATE UNIQUE INDEX "MembershipPayment_stripeSessionId_key" ON "MembershipPayment"("stripeSessionId");
CREATE INDEX "MembershipPayment_userId_status_idx" ON "MembershipPayment"("userId", "status");
CREATE INDEX "MembershipPayment_tier_status_idx" ON "MembershipPayment"("tier", "status");

ALTER TABLE "MembershipPayment"
ADD CONSTRAINT "MembershipPayment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
