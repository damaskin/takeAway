-- Settlements with brands: commission rate history and payouts.
-- See docs/settlements.md.

-- CreateEnum
CREATE TYPE "CommissionRateSource" AS ENUM ('PLAN', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "BrandCommissionRate" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "bps" INTEGER NOT NULL,
    "source" "CommissionRateSource" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandCommissionRate_pkey" PRIMARY KEY ("id"),
    -- A commission above the whole order is a typo, not a deal.
    CONSTRAINT "BrandCommissionRate_bps_range" CHECK ("bps" >= 0 AND "bps" <= 10000)
);

-- CreateTable
CREATE TABLE "BrandPayout" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cardNetCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "reference" TEXT,
    "comment" TEXT,
    "createdById" TEXT,
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandPayout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BrandPayout_period_order" CHECK ("periodFrom" <= "periodTo"),
    -- Nothing owed is never fixed: a negative balance is carried forward.
    CONSTRAINT "BrandPayout_amount_positive" CHECK ("amountCents" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandCommissionRate_brandId_effectiveFrom_key" ON "BrandCommissionRate"("brandId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "BrandPayout_brandId_currency_periodEnd_idx" ON "BrandPayout"("brandId", "currency", "periodEnd");

-- AddForeignKey
ALTER TABLE "BrandCommissionRate" ADD CONSTRAINT "BrandCommissionRate_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPayout" ADD CONSTRAINT "BrandPayout_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every brand starts its history with the rate it has today, from the day it
-- was created. Commission only came in with plans on 2026-10-04 and no earlier
-- rate was ever recorded, so today's rate is the best record of the past. A
-- platform admin can correct it with a dated rate on the settlements page.
INSERT INTO "BrandCommissionRate" ("id", "brandId", "bps", "source", "effectiveFrom", "note")
SELECT
  'bcr_' || b."id",
  b."id",
  b."commissionBps",
  CASE
    WHEN b."commissionBps" = (CASE b."plan" WHEN 'PRO' THEN 1500 ELSE 1000 END) THEN 'PLAN'::"CommissionRateSource"
    ELSE 'INDIVIDUAL'::"CommissionRateSource"
  END,
  b."createdAt",
  NULL
FROM "Brand" b;
