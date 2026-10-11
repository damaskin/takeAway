-- The add-ons library («Добавки») becomes the one place an add-on is
-- defined: next to its name and stock switch it now keeps its usual price,
-- which an option put on a product from the library starts at.
-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "priceCents" INTEGER NOT NULL DEFAULT 0;

-- Existing entries take the price their options charge most often (the
-- lower one on a tie), so the library opens with real prices instead of
-- zeros. Entries no option uses yet stay at 0.
UPDATE "Ingredient" AS i
SET "priceCents" = usage."price"
FROM (
  SELECT DISTINCT ON ("ingredientId") "ingredientId", "price"
  FROM (
    SELECT "ingredientId", "priceDeltaCents" AS "price" FROM "Modifier" WHERE "ingredientId" IS NOT NULL
    UNION ALL
    SELECT "ingredientId", "priceDeltaCents" AS "price" FROM "Variation" WHERE "ingredientId" IS NOT NULL
  ) AS options
  GROUP BY "ingredientId", "price"
  ORDER BY "ingredientId", COUNT(*) DESC, "price" ASC
) AS usage
WHERE i."id" = usage."ingredientId";
