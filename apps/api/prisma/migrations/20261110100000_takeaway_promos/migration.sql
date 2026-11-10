-- «Акции takeAway» (Maxim's list 5.0, item 20; docs/takeaway-promos.md):
-- percent discounts takeAway runs at every venue at its own expense, and the
-- welcome bonus built on them. The guest pays P − D, takeAway owes the venue
-- D (a TakeawayPromoRedemption) and settles it in the payout, which now
-- carries it as `compensationCents`; the commission is taken on the full
-- menu price. Nothing existing changes: older orders and payouts read 0.

-- CreateEnum
CREATE TYPE "TakeawayPromoStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXHAUSTED');

-- AlterTable
ALTER TABLE "BrandPayout" ADD COLUMN     "compensationCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "takeawayDiscountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TakeawayPromo" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "budgetCents" INTEGER NOT NULL,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "status" "TakeawayPromoStatus" NOT NULL DEFAULT 'ACTIVE',
    "exhaustedAt" TIMESTAMP(3),
    "isWelcome" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TakeawayPromo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeawayPromoRedemption" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "code" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "menuTotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeawayPromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomeBonus" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WelcomeBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TakeawayPromo_code_key" ON "TakeawayPromo"("code");

-- CreateIndex
CREATE INDEX "TakeawayPromo_isWelcome_status_idx" ON "TakeawayPromo"("isWelcome", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TakeawayPromoRedemption_orderId_key" ON "TakeawayPromoRedemption"("orderId");

-- CreateIndex
CREATE INDEX "TakeawayPromoRedemption_brandId_currency_idx" ON "TakeawayPromoRedemption"("brandId", "currency");

-- CreateIndex
CREATE INDEX "TakeawayPromoRedemption_payoutId_idx" ON "TakeawayPromoRedemption"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "TakeawayPromoRedemption_promoId_userId_key" ON "TakeawayPromoRedemption"("promoId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeBonus_userId_key" ON "WelcomeBonus"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeBonus_identityHash_key" ON "WelcomeBonus"("identityHash");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeBonus_orderId_key" ON "WelcomeBonus"("orderId");

-- CreateIndex
CREATE INDEX "WelcomeBonus_notifiedAt_createdAt_idx" ON "WelcomeBonus"("notifiedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "TakeawayPromoRedemption" ADD CONSTRAINT "TakeawayPromoRedemption_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "TakeawayPromo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeawayPromoRedemption" ADD CONSTRAINT "TakeawayPromoRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeawayPromoRedemption" ADD CONSTRAINT "TakeawayPromoRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeawayPromoRedemption" ADD CONSTRAINT "TakeawayPromoRedemption_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "BrandPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeBonus" ADD CONSTRAINT "WelcomeBonus_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "TakeawayPromo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeBonus" ADD CONSTRAINT "WelcomeBonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeBonus" ADD CONSTRAINT "WelcomeBonus_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The budget never goes negative or past its limit, whatever two checkouts
-- do at once (the API takes it with a conditional update; this is the floor
-- under that), and a promo always leaves something to pay by card.
ALTER TABLE "TakeawayPromo" ADD CONSTRAINT "TakeawayPromo_spent_within_budget"
  CHECK ("spentCents" >= 0 AND "spentCents" <= "budgetCents");
ALTER TABLE "TakeawayPromo" ADD CONSTRAINT "TakeawayPromo_percent_range"
  CHECK ("percent" BETWEEN 1 AND 99);
