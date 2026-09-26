-- Store shifts: a store takes orders only while a shift is open.
CREATE TABLE "StoreShift" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "StoreShift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreShift_storeId_closedAt_idx" ON "StoreShift"("storeId", "closedAt");

-- One open shift per store. Two tablets tapping "Start work" at once must not
-- leave two open rows behind.
CREATE UNIQUE INDEX "StoreShift_one_open_per_store" ON "StoreShift"("storeId") WHERE "closedAt" IS NULL;

ALTER TABLE "StoreShift" ADD CONSTRAINT "StoreShift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreShift" ADD CONSTRAINT "StoreShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreShift" ADD CONSTRAINT "StoreShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stores that are live today keep taking orders after this deploy: each gets
-- an open shift, so nothing goes dark before staff learn the new button. From
-- here on "Finish work" / "Start work" decide.
INSERT INTO "StoreShift" ("id", "storeId", "openedAt")
SELECT 'shift_' || "id", "id", CURRENT_TIMESTAMP FROM "Store" WHERE "status" <> 'CLOSED';
