-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('PUSH', 'TELEGRAM', 'EMAIL');

-- CreateEnum
CREATE TYPE "CampaignAudience" AS ENUM ('ALL', 'HAS_ORDERED', 'INACTIVE_30D');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "audience" "CampaignAudience" NOT NULL DEFAULT 'ALL',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_brandId_status_idx" ON "Campaign"("brandId", "status");

-- CreateIndex
CREATE INDEX "Campaign_brandId_createdAt_idx" ON "Campaign"("brandId", "createdAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
