-- The inactive-customer segment («Неактивные клиенты»: at least 3 orders and
-- none for 3, 7 or 14 days) as a campaign audience and as a restriction on
-- who may use a promo code. Both keep the days and the optional store; the
-- customers are worked out when the campaign is sent or the code is used.
-- AlterEnum
ALTER TYPE "CampaignAudience" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "inactiveDays" INTEGER,
ADD COLUMN     "segmentStoreId" TEXT;

-- AlterTable
ALTER TABLE "Promo" ADD COLUMN     "inactiveDays" INTEGER,
ADD COLUMN     "segmentStoreId" TEXT;
