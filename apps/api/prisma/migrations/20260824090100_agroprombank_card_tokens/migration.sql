-- CreateEnum
CREATE TYPE "CardTokenStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CardBindingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CardToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'AGROPROMBANK',
    "tokenCipher" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "maskedPan" TEXT,
    "embossing" TEXT,
    "institute" TEXT,
    "label" TEXT,
    "status" "CardTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "cardState" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardBindingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'AGROPROMBANK',
    "bankRequestId" TEXT NOT NULL,
    "lastDigits" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "institute" TEXT NOT NULL,
    "deactivateOld" BOOLEAN NOT NULL DEFAULT false,
    "status" "CardBindingStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "cardTokenId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardBindingRequest_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cardTokenId" TEXT,
ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "tipCents" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "CardToken_userId_tokenFingerprint_key" ON "CardToken"("userId", "tokenFingerprint");

-- CreateIndex
CREATE INDEX "CardToken_tokenFingerprint_idx" ON "CardToken"("tokenFingerprint");

-- CreateIndex
CREATE INDEX "CardToken_userId_status_idx" ON "CardToken"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardBindingRequest_provider_bankRequestId_key" ON "CardBindingRequest"("provider", "bankRequestId");

-- CreateIndex
CREATE INDEX "CardBindingRequest_userId_status_idx" ON "CardBindingRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "CardBindingRequest_expiresAt_idx" ON "CardBindingRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_invoiceId_key" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_cardTokenId_idx" ON "Payment"("cardTokenId");

-- CreateIndex
CREATE INDEX "Payment_provider_status_idx" ON "Payment"("provider", "status");

-- AddForeignKey
ALTER TABLE "CardToken" ADD CONSTRAINT "CardToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardBindingRequest" ADD CONSTRAINT "CardBindingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardBindingRequest" ADD CONSTRAINT "CardBindingRequest_cardTokenId_fkey" FOREIGN KEY ("cardTokenId") REFERENCES "CardToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cardTokenId_fkey" FOREIGN KEY ("cardTokenId") REFERENCES "CardToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
