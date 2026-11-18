-- Maxim's remarks on «Добавки и Варианты» (2026-11-18), item 7, and the
-- owner's decision of the same day: the older per-product options do not
-- exist any more. The options catalog is the only way to offer a size, a
-- milk or a sauce.
--
-- Deleted everywhere, for every brand (production has no business data,
-- staging only test brands): the products' variations (`Variation`) and
-- extras (`Modifier`), the category option sets (`CategoryOption`), the
-- brands' add-on library (`Ingredient`) and its store stops
-- (`StoreIngredientStop`) — what SUPER_ADMIN's «clear old options» deleted
-- per brand, now for all of them, with their tables.
--
-- Cart lines made with older options are dropped and their carts
-- re-totalled, as that action did (the ETA is quoted again on the next
-- read). Placed orders keep their snapshots (`OrderItem.productSnapshot`
-- is JSON with names and prices as bought).

-- Cart lines that carry a variation or an extra with a count of at least 1.
DELETE FROM "CartItem" AS item
WHERE cardinality(item."variationIds") > 0
   OR (
     jsonb_typeof(item."modifiersJson") = 'object'
     AND EXISTS (
       SELECT 1
       FROM jsonb_each(item."modifiersJson") AS e(key, value)
       WHERE (jsonb_typeof(e.value) = 'number' AND (e.value #>> '{}')::numeric >= 1)
          OR (
            jsonb_typeof(e.value) = 'string'
            AND (e.value #>> '{}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
            AND trim(e.value #>> '{}')::numeric >= 1
          )
     )
   );

-- Every cart's total from the lines it has left; a cart left empty waits for
-- nothing (as dropping lines in the admin does).
UPDATE "Cart" AS cart
SET "subtotalCents" = totals.subtotal,
    "etaSeconds" = CASE WHEN totals.lines = 0 THEN 0 ELSE cart."etaSeconds" END
FROM (
  SELECT c."id",
         COALESCE(SUM(item."unitPriceCents" * item."quantity"), 0)::int AS subtotal,
         COUNT(item."id") AS lines
  FROM "Cart" AS c
  LEFT JOIN "CartItem" AS item ON item."cartId" = c."id"
  GROUP BY c."id"
) AS totals
WHERE cart."id" = totals."id"
  AND (cart."subtotalCents" <> totals.subtotal OR (totals.lines = 0 AND cart."etaSeconds" <> 0));

-- DropForeignKey
ALTER TABLE "Variation" DROP CONSTRAINT "Variation_productId_fkey";
ALTER TABLE "Variation" DROP CONSTRAINT "Variation_ingredientId_fkey";
ALTER TABLE "Modifier" DROP CONSTRAINT "Modifier_productId_fkey";
ALTER TABLE "Modifier" DROP CONSTRAINT "Modifier_ingredientId_fkey";
ALTER TABLE "Ingredient" DROP CONSTRAINT "Ingredient_brandId_fkey";
ALTER TABLE "CategoryOption" DROP CONSTRAINT "CategoryOption_categoryId_fkey";
ALTER TABLE "CategoryOption" DROP CONSTRAINT "CategoryOption_ingredientId_fkey";
ALTER TABLE "StoreIngredientStop" DROP CONSTRAINT "StoreIngredientStop_storeId_fkey";
ALTER TABLE "StoreIngredientStop" DROP CONSTRAINT "StoreIngredientStop_ingredientId_fkey";

-- AlterTable
ALTER TABLE "CartItem" DROP COLUMN "modifiersJson",
DROP COLUMN "variationIds";

-- DropTable
DROP TABLE "Variation";
DROP TABLE "Modifier";
DROP TABLE "CategoryOption";
DROP TABLE "StoreIngredientStop";
DROP TABLE "Ingredient";

-- DropEnum
DROP TYPE "VariationType";
DROP TYPE "CategoryOptionKind";
