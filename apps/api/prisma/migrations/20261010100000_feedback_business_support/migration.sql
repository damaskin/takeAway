-- «Написать в поддержку» and «Перейти на PRO» in the business admin: a
-- brand's staff write to the platform team through the customer feedback
-- pipeline. Their messages carry the BUSINESS source, a QUESTION or
-- PLAN_CHANGE kind besides the customer ones, and the brand they are about.
--
-- The new enum values are not used in this migration: PostgreSQL refuses to
-- use a value added by ALTER TYPE inside the transaction that added it.
-- AlterEnum
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'QUESTION';

-- AlterEnum
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'PLAN_CHANGE';

-- AlterEnum
ALTER TYPE "FeedbackSource" ADD VALUE IF NOT EXISTS 'BUSINESS';

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "brandId" TEXT;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
