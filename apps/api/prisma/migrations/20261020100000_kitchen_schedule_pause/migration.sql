-- Kitchen policy, owner decisions of 2026-10-20 (docs/kitchen-policy.md).
--
-- StoreShift: the schedule now opens shifts by itself; such a shift is marked.
-- Store: the kitchen's «Пауза» — until when, why, a comment, who set it.
-- Order: the kitchen's new estimate when it accepted or started an order too
-- late for its pickup time.
-- No backfill: every new column is empty or false for existing rows.

-- CreateEnum
CREATE TYPE "StorePauseReason" AS ENUM ('EQUIPMENT', 'NO_INGREDIENTS', 'NO_STAFF', 'OTHER');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "pauseComment" TEXT,
ADD COLUMN     "pauseReason" "StorePauseReason",
ADD COLUMN     "pausedById" TEXT,
ADD COLUMN     "pausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoreShift" ADD COLUMN     "openedAutomatically" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "readyEstimateAt" TIMESTAMP(3);
