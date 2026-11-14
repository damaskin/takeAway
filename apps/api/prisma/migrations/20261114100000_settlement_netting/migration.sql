-- Settlements with brands become a netted «взаимозачёт» (Maxim's list 6.0,
-- item 7; owner 2026-11-14): guests pay the brand directly, the brand owes
-- takeAway its commission, takeAway owes the brand compensation for its own
-- promos and — new — for the loyalty points spent, and one sum is paid the
-- way the difference points. The payer marks it paid, the receiver confirms
-- «получено» or «не получено». docs/settlements.md.
--
-- Enum values land here and are used only by the next migration: PostgreSQL
-- refuses a value added by ALTER TYPE inside the transaction that added it.

-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';

-- CreateEnum
CREATE TYPE "SettlementDirection" AS ENUM ('BRAND_TO_TAKEAWAY', 'TAKEAWAY_TO_BRAND');

-- AlterTable: every payout fixed so far was takeAway paying the brand.
ALTER TABLE "BrandPayout" ADD COLUMN     "direction" "SettlementDirection" NOT NULL DEFAULT 'TAKEAWAY_TO_BRAND',
ADD COLUMN     "pointsCompensationCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "disputeComment" TEXT,
ADD COLUMN     "confirmedById" TEXT;
ALTER TABLE "BrandPayout" ALTER COLUMN "direction" DROP DEFAULT;
