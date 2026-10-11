-- Kitchen tablets bound to one brand. The PIN screen used to list every
-- store of every brand to anyone (and PIN sign-in worked from anywhere with
-- a store id). Now a tablet is bound once — by a signed-in employee of the
-- brand or a one-time link from the Staff page — and keeps a long-lived
-- token whose SHA-256 is stored here. Tablets already signed in bind
-- themselves the next time they open the kitchen board.
-- CreateTable
CREATE TABLE "KitchenDevice" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "KitchenDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KitchenDevice_tokenHash_key" ON "KitchenDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KitchenDevice_brandId_idx" ON "KitchenDevice"("brandId");

-- AddForeignKey
ALTER TABLE "KitchenDevice" ADD CONSTRAINT "KitchenDevice_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
