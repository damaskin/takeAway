-- Every campaign a business composes is reviewed by a SUPER_ADMIN before it
-- is sent: DRAFT → PENDING_REVIEW → APPROVED (→ SENDING → SENT / FAILED) or
-- REJECTED with a reason. A run never starts without `approvedAt`.
--
-- Existing rows, on the safe side:
-- - SCHEDULED (never written by the code, but possible in data), FAILED and
--   SENDING have not reached their audience — or not all of it — and a
--   retry would now send unreviewed copy, so they go into the review queue
--   as PENDING_REVIEW. A run interrupted by this deploy is one of them.
-- - DRAFT stays a draft: it was never sent and needs a submit like any new one.
-- - SENT stays SENT, without approval: it is history, and its "retry the
--   failures" button is gone, because the copy was never reviewed.
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterEnum: SCHEDULED is gone; PENDING_REVIEW, APPROVED and REJECTED are new.
BEGIN;
CREATE TYPE "CampaignStatus_new" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SENDING', 'SENT', 'FAILED');
ALTER TABLE "Campaign" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Campaign" ALTER COLUMN "status" TYPE "CampaignStatus_new" USING (
  CASE "status"::text
    WHEN 'SCHEDULED' THEN 'PENDING_REVIEW'
    WHEN 'SENDING' THEN 'PENDING_REVIEW'
    WHEN 'FAILED' THEN 'PENDING_REVIEW'
    ELSE "status"::text
  END
)::"CampaignStatus_new";
ALTER TYPE "CampaignStatus" RENAME TO "CampaignStatus_old";
ALTER TYPE "CampaignStatus_new" RENAME TO "CampaignStatus";
DROP TYPE "CampaignStatus_old";
ALTER TABLE "Campaign" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- The moved rows join the review queue now.
UPDATE "Campaign" SET "submittedAt" = CURRENT_TIMESTAMP WHERE "status" = 'PENDING_REVIEW';

-- CreateIndex
CREATE INDEX "Campaign_status_submittedAt_idx" ON "Campaign"("status", "submittedAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
