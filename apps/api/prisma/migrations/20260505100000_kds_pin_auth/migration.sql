-- KDS PIN auth — short numeric PIN scoped to one store, used as a lockscreen
-- credential on the shared kitchen tablet. PIN is never stored raw; we keep
-- the HMAC-SHA256 hash with KDS_PIN_SECRET as the key, so login is an O(1)
-- index lookup rather than O(N) bcrypt comparisons across staff.

ALTER TABLE "User"
  ADD COLUMN "kdsPinHash" TEXT,
  ADD COLUMN "kdsPinStoreId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_kdsPinStoreId_fkey"
  FOREIGN KEY ("kdsPinStoreId") REFERENCES "Store"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-store PIN uniqueness: two staff in the same store can't share a PIN.
-- Partial — NULLs from staff without a PIN don't block the constraint.
CREATE UNIQUE INDEX "User_kdsPin_uniq"
  ON "User" ("kdsPinStoreId", "kdsPinHash")
  WHERE "kdsPinStoreId" IS NOT NULL AND "kdsPinHash" IS NOT NULL;

-- Login lookup: hash + store, indexed for sub-millisecond fetch on PIN entry.
CREATE INDEX "User_kdsPinHash_idx"
  ON "User" ("kdsPinHash")
  WHERE "kdsPinHash" IS NOT NULL;
