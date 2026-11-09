-- The order-queue policy (docs/queue-policy.md), behind QUEUE_POLICY_ENABLED.
-- No backfill: `OrderItem.prepSeconds` / `prepParallel` stay null on orders
-- placed before the flag is on, and the queue reads their product as it is
-- now (C is the existing `Store.kitchenParallelism`).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "placedUnderLoad" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "prepParallel" BOOLEAN,
ADD COLUMN     "prepSeconds" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "prepParallel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "loadExtraSeconds" INTEGER NOT NULL DEFAULT 600;
