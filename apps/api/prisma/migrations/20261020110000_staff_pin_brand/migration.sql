-- One kitchen PIN per employee for every store they work at in the brand
-- (docs/staff-access.md). A new PIN is hashed with the brand id instead of a
-- store id and is unique within the brand. PINs set before this keep their
-- store (kdsPinStoreId) and their store-scoped hash, and keep working until
-- they are replaced or reset on the employee's page.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kdsPinBrandId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_kdsPinBrandId_fkey" FOREIGN KEY ("kdsPinBrandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Two employees of one brand never share a PIN. Partial, like the per-store
-- index of the old PINs: people without a brand PIN don't take part.
CREATE UNIQUE INDEX "User_kdsPinBrand_uniq"
  ON "User" ("kdsPinBrandId", "kdsPinHash")
  WHERE "kdsPinBrandId" IS NOT NULL AND "kdsPinHash" IS NOT NULL;
