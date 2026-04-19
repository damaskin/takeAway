-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('SILVER', 'GOLD', 'PLATINUM', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "PointsEntryType" AS ENUM ('EARN', 'SPEND', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('PERCENT', 'FIXED', 'BOGO', 'POINTS_MULTIPLIER');

-- CreateEnum
CREATE TYPE "PromoStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "tier" "LoyaltyTier" NOT NULL DEFAULT 'SILVER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsLedger" (
    "id" TEXT NOT NULL,
    "loyaltyAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "PointsEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promo" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "PromoType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSubtotalCents" INTEGER,
    "maxRedemptions" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "PromoStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_userId_key" ON "LoyaltyAccount"("userId");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_tier_idx" ON "LoyaltyAccount"("tier");

-- CreateIndex
CREATE INDEX "PointsLedger_userId_createdAt_idx" ON "PointsLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedger_orderId_idx" ON "PointsLedger"("orderId");

-- CreateIndex
CREATE INDEX "Promo_brandId_status_idx" ON "Promo"("brandId", "status");

-- CreateIndex
CREATE INDEX "Promo_startsAt_endsAt_idx" ON "Promo"("startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Promo_brandId_code_key" ON "Promo"("brandId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_orderId_key" ON "PromoRedemption"("orderId");

-- CreateIndex
CREATE INDEX "PromoRedemption_promoId_idx" ON "PromoRedemption"("promoId");

-- CreateIndex
CREATE INDEX "PromoRedemption_userId_idx" ON "PromoRedemption"("userId");

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promo" ADD CONSTRAINT "Promo_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
