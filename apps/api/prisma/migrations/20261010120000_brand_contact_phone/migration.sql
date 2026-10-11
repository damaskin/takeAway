-- The phone the platform team calls a business on (required at sign-up from
-- now on), and the owner's request to move to another plan («Перейти на PRO»).
-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "planRequestedAt" TIMESTAMP(3),
ADD COLUMN     "requestedPlan" "BrandPlan";

-- Brands from before keep a null phone, unless the owner gave one on their
-- account at sign-up (the optional field of the old form, already E.164).
UPDATE "Brand" AS b
SET "contactPhone" = u."phone"
FROM "User" AS u
WHERE b."ownerId" = u."id" AND u."phone" IS NOT NULL;
