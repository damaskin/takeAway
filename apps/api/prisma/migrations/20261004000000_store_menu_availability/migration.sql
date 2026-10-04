-- Per-store menu: a product is sold only in the stores listed for it, and a
-- store can run out of a library ingredient on its own.

-- CreateTable
CREATE TABLE "ProductStore" (
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductStore_pkey" PRIMARY KEY ("productId","storeId")
);

-- CreateTable
CREATE TABLE "StoreIngredientStop" (
    "storeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreIngredientStop_pkey" PRIMARY KEY ("storeId","ingredientId")
);

-- CreateIndex
CREATE INDEX "ProductStore_storeId_idx" ON "ProductStore"("storeId");

-- CreateIndex
CREATE INDEX "StoreIngredientStop_ingredientId_idx" ON "StoreIngredientStop"("ingredientId");

-- AddForeignKey
ALTER TABLE "ProductStore" ADD CONSTRAINT "ProductStore_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStore" ADD CONSTRAINT "ProductStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIngredientStop" ADD CONSTRAINT "StoreIngredientStop_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIngredientStop" ADD CONSTRAINT "StoreIngredientStop_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nothing disappears from any menu: every existing product is listed in
-- every store of its brand, which is what the brand-wide menu meant until now.
INSERT INTO "ProductStore" ("productId", "storeId", "createdAt")
SELECT p."id", s."id", NOW()
FROM "Product" p
JOIN "Store" s ON s."brandId" = p."brandId"
ON CONFLICT DO NOTHING;
