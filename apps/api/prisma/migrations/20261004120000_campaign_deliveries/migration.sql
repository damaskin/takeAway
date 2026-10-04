-- Campaign runs move to the background: per-recipient delivery rows make a
-- retry skip people who already got the message, and the campaign keeps
-- no-channel / opted-out counters plus the last error for the admin.
-- CreateEnum
CREATE TYPE "CampaignDeliveryOutcome" AS ENUM ('SENT', 'FAILED', 'NO_CHANNEL', 'OPTED_OUT');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "noChannelCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "optedOutCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CampaignDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" "CampaignDeliveryOutcome" NOT NULL,
    "via" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignDelivery_campaignId_outcome_idx" ON "CampaignDelivery"("campaignId", "outcome");

-- CreateIndex
CREATE INDEX "CampaignDelivery_userId_idx" ON "CampaignDelivery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignDelivery_campaignId_userId_key" ON "CampaignDelivery"("campaignId", "userId");

-- AddForeignKey
ALTER TABLE "CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

