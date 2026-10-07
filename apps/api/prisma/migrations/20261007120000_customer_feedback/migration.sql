-- Customer feedback from the profile («Обратная связь»): reviews, suggestions
-- and problem reports, read by the platform team in the admin.
-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('REVIEW', 'SUGGESTION', 'PROBLEM');

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('IOS', 'ANDROID', 'WEB', 'TMA');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "message" TEXT NOT NULL,
    "contact" TEXT,
    "source" "FeedbackSource" NOT NULL,
    "appVersion" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
