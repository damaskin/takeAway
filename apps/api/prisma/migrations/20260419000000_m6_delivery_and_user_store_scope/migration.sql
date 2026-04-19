-- M6: Delivery + Multi-store roles.
--
-- Schema changes:
--   1. Role enum gets a RIDER value (a distinct user role for delivery couriers).
--   2. StoreFulfillment enum gets DELIVERY (so admins can toggle per-store
--      support). FulfillmentType already had DELIVERY from an earlier migration.
--   3. OrderStatus gets OUT_FOR_DELIVERY and DELIVERED terminal states. PICKED_UP
--      stays as the PICKUP terminal; DELIVERY orders bypass it entirely.
--   4. New table `UserStore` pivoting staff-to-store assignments. Global
--      roles (BRAND_ADMIN, SUPER_ADMIN) don't need rows; scope service treats
--      them as all-stores.
--   5. Order gains delivery-specific columns (address, fee, distance, rider,
--      and two timestamp slots for the new status transitions).

-- AlterEnum — Role
ALTER TYPE "Role" ADD VALUE 'RIDER';

-- AlterEnum — StoreFulfillment
ALTER TYPE "StoreFulfillment" ADD VALUE 'DELIVERY';

-- AlterEnum — OrderStatus (append; enum additions must be separate txn from use)
ALTER TYPE "OrderStatus" ADD VALUE 'OUT_FOR_DELIVERY';
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERED';

-- CreateTable
CREATE TABLE "UserStore" (
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStore_pkey" PRIMARY KEY ("userId","storeId")
);

-- CreateIndex
CREATE INDEX "UserStore_storeId_idx" ON "UserStore"("storeId");

-- AddForeignKey
ALTER TABLE "UserStore" ADD CONSTRAINT "UserStore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserStore" ADD CONSTRAINT "UserStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable — Order (delivery fields)
ALTER TABLE "Order"
  ADD COLUMN "deliveryAddressLine" TEXT,
  ADD COLUMN "deliveryCity"        TEXT,
  ADD COLUMN "deliveryLatitude"    DOUBLE PRECISION,
  ADD COLUMN "deliveryLongitude"   DOUBLE PRECISION,
  ADD COLUMN "deliveryNotes"       TEXT,
  ADD COLUMN "deliveryFeeCents"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryDistanceM"   INTEGER,
  ADD COLUMN "riderId"             TEXT,
  ADD COLUMN "outForDeliveryAt"    TIMESTAMP(3),
  ADD COLUMN "deliveredAt"         TIMESTAMP(3);

-- AddForeignKey — rider
ALTER TABLE "Order" ADD CONSTRAINT "Order_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex — rider dispatch queues
CREATE INDEX "Order_riderId_status_idx" ON "Order"("riderId", "status");
