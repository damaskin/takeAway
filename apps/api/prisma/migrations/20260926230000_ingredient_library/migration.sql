-- Ingredient library: a brand's add-ins (oat milk, vanilla syrup…) live in
-- one list with an in-stock switch, and product options point at them.
-- AlterTable
ALTER TABLE "Variation" ADD COLUMN     "ingredientId" TEXT;

-- AlterTable
ALTER TABLE "Modifier" ADD COLUMN     "ingredientId" TEXT;

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ingredient_brandId_isAvailable_idx" ON "Ingredient"("brandId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_brandId_name_key" ON "Ingredient"("brandId", "name");

-- CreateIndex
CREATE INDEX "Variation_ingredientId_idx" ON "Variation"("ingredientId");

-- CreateIndex
CREATE INDEX "Modifier_ingredientId_idx" ON "Modifier"("ingredientId");

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing options move into the library without losing anything: every
-- extra (modifier) and every milk choice becomes an ingredient of its brand,
-- one per distinct name, switched on, and the option is linked to it. Sizes,
-- temperatures and cups are not ingredients and stay unlinked (always shown).
-- Ids are derived from brand + name so the statement is deterministic.
INSERT INTO "Ingredient" ("id", "brandId", "name", "isAvailable", "createdAt", "updatedAt")
SELECT 'ing' || substr(md5(src."brandId" || '/' || src."name"), 1, 22), src."brandId", src."name", true, NOW(), NOW()
FROM (
  SELECT p."brandId", btrim(m."name") AS "name"
  FROM "Modifier" m JOIN "Product" p ON p."id" = m."productId"
  UNION
  SELECT p."brandId", btrim(v."name") AS "name"
  FROM "Variation" v JOIN "Product" p ON p."id" = v."productId"
  WHERE v."type" = 'MILK'
) src
WHERE src."name" <> ''
ON CONFLICT ("brandId", "name") DO NOTHING;

UPDATE "Modifier" m
SET "ingredientId" = i."id"
FROM "Product" p, "Ingredient" i
WHERE p."id" = m."productId" AND i."brandId" = p."brandId" AND i."name" = btrim(m."name");

UPDATE "Variation" v
SET "ingredientId" = i."id"
FROM "Product" p, "Ingredient" i
WHERE v."type" = 'MILK' AND p."id" = v."productId" AND i."brandId" = p."brandId" AND i."name" = btrim(v."name");
