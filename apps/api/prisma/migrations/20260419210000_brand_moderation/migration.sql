-- Migration: brand moderation + ownership
--
-- Adds the BrandModerationStatus enum plus the columns that power the
-- self-serve business registration flow. Existing rows (the seed brand
-- and any manually-created ones) are auto-approved.

CREATE TYPE "BrandModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Brand"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "moderationStatus" "BrandModerationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "moderationNote" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "moderatedAt" TIMESTAMP(3);

-- Backfill: everything that was already in the DB is trusted.
UPDATE "Brand"
SET "moderationStatus" = 'APPROVED',
    "moderatedAt"      = "createdAt";

CREATE INDEX "Brand_moderationStatus_idx" ON "Brand"("moderationStatus");
CREATE INDEX "Brand_ownerId_idx" ON "Brand"("ownerId");

ALTER TABLE "Brand"
  ADD CONSTRAINT "Brand_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
