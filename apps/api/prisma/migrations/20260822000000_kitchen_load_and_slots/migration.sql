-- Honest ETA: derive the wait from the kitchen's actual queue instead of a
-- static field, and cap how many orders one 15-minute slot may promise.
--
-- "currentEtaSeconds" was never current — nothing recomputed it, so twenty
-- orders at 08:40 quoted the same wait as one order at 15:00. Renaming it to
-- "baseEtaSeconds" states what it actually is: fixed per-order overhead. The
-- live part now comes from summing outstanding work on the store.

ALTER TABLE "Store" RENAME COLUMN "currentEtaSeconds" TO "baseEtaSeconds";

ALTER TABLE "Store"
  ADD COLUMN "kitchenParallelism" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "slotCapacity" INTEGER NOT NULL DEFAULT 8;

-- prepSeconds: what the customer waits once work starts (longest item).
-- workSeconds: what the order costs the kitchen (sum of items).
-- Two different numbers on purpose — see the schema comments.
ALTER TABLE "Order"
  ADD COLUMN "prepSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "workSeconds" INTEGER NOT NULL DEFAULT 0;

-- Slot occupancy counts one store's handovers inside a 15-minute window and
-- runs on every checkout render.
CREATE INDEX "Order_storeId_pickupAt_idx" ON "Order" ("storeId", "pickupAt");
