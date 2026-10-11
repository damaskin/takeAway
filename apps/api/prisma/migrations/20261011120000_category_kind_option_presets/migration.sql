-- Category kinds (hot drinks, cold drinks, food, bakery, other), a default
-- preparation time per category, add-on groups («Сиропы», «Убрать») on
-- product extras and library entries, and the category option set that is
-- copied onto the category's products.

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('HOT_DRINKS', 'COLD_DRINKS', 'FOOD', 'BAKERY', 'OTHER');

-- CreateEnum
CREATE TYPE "CategoryOptionKind" AS ENUM ('VARIATION', 'MODIFIER');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "defaultPrepTimeSeconds" INTEGER,
ADD COLUMN     "kind" "CategoryKind" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "Modifier" ADD COLUMN     "group" TEXT;

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "group" TEXT;

-- CreateTable
CREATE TABLE "CategoryOption" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "kind" "CategoryOptionKind" NOT NULL,
    "variationType" "VariationType",
    "name" TEXT NOT NULL,
    "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "group" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "maxCount" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ingredientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryOption_categoryId_sortOrder_idx" ON "CategoryOption"("categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "CategoryOption_ingredientId_idx" ON "CategoryOption"("ingredientId");

-- AddForeignKey
ALTER TABLE "CategoryOption" ADD CONSTRAINT "CategoryOption_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryOption" ADD CONSTRAINT "CategoryOption_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Infer the kind of every existing category from its name: the same word
-- beginnings and the same order as `inferCategoryKind` in libs/utils
-- (category-kind.ts) — food first, then cold drinks, hot drinks, bakery;
-- the first match wins, anything else stays OTHER. `translate` lower-cases
-- Cyrillic and Latin whatever the database collation (lower() folds only
-- ASCII under the C locale), and every pattern matches at a word start.

UPDATE "Category" SET "kind" = 'FOOD'
WHERE "kind" = 'OTHER'
  AND translate("name", 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяabcdefghijklmnopqrstuvwxyz')
      ~ '(^|[^a-zа-яё])(шаурм|шаверм|бургер|сэндвич|сендвич|хот-?дог|хот дог|завтрак|салат|суп|пицц|ролл|фаст-?фуд|стрит-?фуд|блюд|еда|закуск|ланч|обед|боул|тортиль|food|burger|sandwich|hot-?dog|hot dog|breakfast|salad|soup|pizza|lunch|meal|dish|snack)';

UPDATE "Category" SET "kind" = 'COLD_DRINKS'
WHERE "kind" = 'OTHER'
  AND translate("name", 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяabcdefghijklmnopqrstuvwxyz')
      ~ '(^|[^a-zа-яё])(холодн|айс|со льдом|лимонад|смузи|коктейл|милкшейк|фрапп|вода|воды|сок|газир|морс|ice|cold|lemonade|smoothie|juice|milkshake|frapp|soda|water)';

UPDATE "Category" SET "kind" = 'HOT_DRINKS'
WHERE "kind" = 'OTHER'
  AND translate("name", 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяabcdefghijklmnopqrstuvwxyz')
      ~ '(^|[^a-zа-яё])(кофе|капучино|латте|американо|эспрессо|раф|флэт|флет|чай|какао|матча|горяч|coffee|cappuccino|latte|americano|espresso|tea|cocoa|matcha|hot)';

UPDATE "Category" SET "kind" = 'BAKERY'
WHERE "kind" = 'OTHER'
  AND translate("name", 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяabcdefghijklmnopqrstuvwxyz')
      ~ '(^|[^a-zа-яё])(выпечк|десерт|пряник|круассан|торт|пирож|пирог|печень|маффин|кекс|чизкейк|булоч|вафл|пончик|донат|эклер|bakery|dessert|pastr|cake|croissant|cookie|muffin|donut|waffle)';
