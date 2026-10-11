-- What a store sells: coffee, food or both. The customer map draws a
-- different marker for each and can filter by it. Every store so far was a
-- coffee shop, so they all start as COFFEE.

-- CreateEnum
CREATE TYPE "StoreKind" AS ENUM ('COFFEE', 'FOOD');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "kinds" "StoreKind"[] DEFAULT ARRAY['COFFEE']::"StoreKind"[];

-- Backfill: the default above already fills existing rows; this makes it
-- explicit and safe to reason about.
UPDATE "Store" SET "kinds" = ARRAY['COFFEE']::"StoreKind"[] WHERE "kinds" IS NULL OR cardinality("kinds") = 0;
