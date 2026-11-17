-- Every brand takes card and QR payments through its own Agroprombank
-- terminal (Maxim, 2026-11-17; docs/settlements.md §9.2). PaymentTerminal
-- holds a brand's registration, secrets encrypted by the API; Payment,
-- CardToken and CardBindingRequest remember which terminal they went through
-- (null: takeAway's default terminal from the API's env — every row so far).

-- AlterTable
ALTER TABLE "CardBindingRequest" ADD COLUMN     "paymentTerminalId" TEXT;

-- AlterTable
ALTER TABLE "CardToken" ADD COLUMN     "paymentTerminalId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentTerminalId" TEXT;

-- CreateTable
CREATE TABLE "PaymentTerminal" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "cardMerchantId" TEXT,
    "cardTerminalId" TEXT,
    "cardPrivateKeyCipher" TEXT,
    "cardCertificatePem" TEXT,
    "cardBankCertificatePem" TEXT,
    "webMerchantLogin" TEXT,
    "webMerchantId" TEXT,
    "webMerchantPassCipher" TEXT,
    "webBankCertificatePem" TEXT,
    "qrTerminalId" TEXT,
    "qrLogin" TEXT,
    "qrPasswordCipher" TEXT,
    "qrExternalTokenCipher" TEXT,
    "holdUntilAccepted" BOOLEAN NOT NULL DEFAULT false,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentTerminal_brandId_retiredAt_idx" ON "PaymentTerminal"("brandId", "retiredAt");

-- CreateIndex
CREATE INDEX "CardToken_paymentTerminalId_idx" ON "CardToken"("paymentTerminalId");

-- CreateIndex
CREATE INDEX "Payment_paymentTerminalId_idx" ON "Payment"("paymentTerminalId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentTerminalId_fkey" FOREIGN KEY ("paymentTerminalId") REFERENCES "PaymentTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTerminal" ADD CONSTRAINT "PaymentTerminal_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTerminal" ADD CONSTRAINT "PaymentTerminal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTerminal" ADD CONSTRAINT "PaymentTerminal_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardToken" ADD CONSTRAINT "CardToken_paymentTerminalId_fkey" FOREIGN KEY ("paymentTerminalId") REFERENCES "PaymentTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardBindingRequest" ADD CONSTRAINT "CardBindingRequest_paymentTerminalId_fkey" FOREIGN KEY ("paymentTerminalId") REFERENCES "PaymentTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

