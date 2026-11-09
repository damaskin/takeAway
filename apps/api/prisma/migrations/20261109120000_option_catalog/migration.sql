-- The options catalog («Добавки и варианты», Maxim's list 5.0 item 17,
-- docs/option-groups.md): one platform catalog of option groups kept by
-- SUPER_ADMIN, brand-wide add-on prices and switches, per-store stops,
-- groups attached to products with per-product variant prices. The older
-- per-product `Variation` / `Modifier` rows are left as they are.

-- CreateEnum
CREATE TYPE "OptionGroupKind" AS ENUM ('VARIANT', 'ADDON');

-- CreateEnum
CREATE TYPE "OptionGroupType" AS ENUM ('A', 'B', 'C', 'D');

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "optionsJson" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "OptionGroup" (
    "id" TEXT NOT NULL,
    "kind" "OptionGroupKind" NOT NULL,
    "type" "OptionGroupType" NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER,
    "maxSelect" INTEGER,
    "showIfOptionId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "minQty" INTEGER,
    "maxQty" INTEGER,
    "defaultQty" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandOptionSetting" (
    "brandId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandOptionSetting_pkey" PRIMARY KEY ("brandId","optionId")
);

-- CreateTable
CREATE TABLE "StoreOptionStop" (
    "storeId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOptionStop_pkey" PRIMARY KEY ("storeId","optionId")
);

-- CreateTable
CREATE TABLE "ProductOptionGroup" (
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductOptionGroup_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "ProductOptionOverride" (
    "productId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "priceCents" INTEGER,
    "isDefault" BOOLEAN,

    CONSTRAINT "ProductOptionOverride_pkey" PRIMARY KEY ("productId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OptionGroup_name_key" ON "OptionGroup"("name");

-- CreateIndex
CREATE INDEX "OptionGroup_kind_sortOrder_idx" ON "OptionGroup"("kind", "sortOrder");

-- CreateIndex
CREATE INDEX "OptionItem_groupId_sortOrder_idx" ON "OptionItem"("groupId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OptionItem_groupId_name_key" ON "OptionItem"("groupId", "name");

-- CreateIndex
CREATE INDEX "BrandOptionSetting_optionId_idx" ON "BrandOptionSetting"("optionId");

-- CreateIndex
CREATE INDEX "StoreOptionStop_optionId_idx" ON "StoreOptionStop"("optionId");

-- CreateIndex
CREATE INDEX "ProductOptionGroup_groupId_idx" ON "ProductOptionGroup"("groupId");

-- CreateIndex
CREATE INDEX "ProductOptionOverride_optionId_idx" ON "ProductOptionOverride"("optionId");

-- AddForeignKey
ALTER TABLE "OptionGroup" ADD CONSTRAINT "OptionGroup_showIfOptionId_fkey" FOREIGN KEY ("showIfOptionId") REFERENCES "OptionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionItem" ADD CONSTRAINT "OptionItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandOptionSetting" ADD CONSTRAINT "BrandOptionSetting_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandOptionSetting" ADD CONSTRAINT "BrandOptionSetting_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "OptionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOptionStop" ADD CONSTRAINT "StoreOptionStop_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOptionStop" ADD CONSTRAINT "StoreOptionStop_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "OptionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OptionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionOverride" ADD CONSTRAINT "ProductOptionOverride_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionOverride" ADD CONSTRAINT "ProductOptionOverride_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "OptionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: the starting catalog of spec §7 (docs/option-groups.md «Seed»).
-- Fixed readable ids, so every environment has the same catalog and
-- inserting is safe on prod. Sizes are split into a name and a note
-- («M» + «300–350 мл»). «Лёд» is one group for coffee and fast food (coffee
-- position, shown with «Холодный»; a product without «Подача» always shows
-- it). «Соус в блюдо» has no catalog default: a dish sets its own sauce.

INSERT INTO "OptionGroup" ("id", "kind", "type", "name", "minSelect", "maxSelect", "sortOrder", "updatedAt") VALUES
  ('og_coffee_size', 'VARIANT', 'A', 'Размер (кофе)', 1, 1, 10, CURRENT_TIMESTAMP),
  ('og_serving', 'VARIANT', 'A', 'Подача', 1, 1, 20, CURRENT_TIMESTAMP),
  ('og_espresso', 'VARIANT', 'A', 'Эспрессо', 1, 1, 30, CURRENT_TIMESTAMP),
  ('og_decaf', 'VARIANT', 'B', 'Без кофеина', NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('og_milk', 'ADDON', 'A', 'Молоко', 1, 1, 50, CURRENT_TIMESTAMP),
  ('og_syrups', 'ADDON', 'A', 'Сиропы', 0, 2, 60, CURRENT_TIMESTAMP),
  ('og_topping_sauce', 'ADDON', 'A', 'Топинг-соус', 0, 1, 70, CURRENT_TIMESTAMP),
  ('og_sprinkles', 'ADDON', 'A', 'Посыпка', 0, 1, 80, CURRENT_TIMESTAMP),
  ('og_foam_top', 'ADDON', 'A', 'Пенка-топ', 0, 1, 90, CURRENT_TIMESTAMP),
  ('og_coffee_extras', 'ADDON', 'B', 'Добавки к кофе', NULL, NULL, 100, CURRENT_TIMESTAMP),
  ('og_sugar', 'ADDON', 'C', 'Сахар', NULL, NULL, 110, CURRENT_TIMESTAMP),
  ('og_ice', 'ADDON', 'C', 'Лёд', NULL, NULL, 120, CURRENT_TIMESTAMP),
  ('og_extra_shot', 'ADDON', 'C', 'Доп. шот', NULL, NULL, 130, CURRENT_TIMESTAMP),
  ('og_burger_size', 'VARIANT', 'A', 'Размер (бургер)', 1, 1, 140, CURRENT_TIMESTAMP),
  ('og_shawarma_size', 'VARIANT', 'A', 'Размер (шаурма)', 1, 1, 150, CURRENT_TIMESTAMP),
  ('og_hotdog_size', 'VARIANT', 'A', 'Размер (хот-дог)', 1, 1, 160, CURRENT_TIMESTAMP),
  ('og_fries_portion', 'VARIANT', 'A', 'Порция (картофель, снеки)', 1, 1, 170, CURRENT_TIMESTAMP),
  ('og_nuggets_portion', 'VARIANT', 'A', 'Порция (наггетсы)', 1, 1, 180, CURRENT_TIMESTAMP),
  ('og_strips_portion', 'VARIANT', 'A', 'Порция (стрипсы)', 1, 1, 190, CURRENT_TIMESTAMP),
  ('og_wings_portion', 'VARIANT', 'A', 'Порция (крылья)', 1, 1, 200, CURRENT_TIMESTAMP),
  ('og_drink_size', 'VARIANT', 'A', 'Размер (напиток)', 1, 1, 210, CURRENT_TIMESTAMP),
  ('og_base', 'VARIANT', 'A', 'Основа', 1, 1, 220, CURRENT_TIMESTAMP),
  ('og_meat', 'VARIANT', 'A', 'Мясо', 1, 1, 230, CURRENT_TIMESTAMP),
  ('og_spicy', 'VARIANT', 'B', 'Острый', NULL, NULL, 240, CURRENT_TIMESTAMP),
  ('og_dish_sauce', 'ADDON', 'A', 'Соус в блюдо', 0, 2, 250, CURRENT_TIMESTAMP),
  ('og_remove_ingredient', 'ADDON', 'B', 'Убрать ингредиент', NULL, NULL, 260, CURRENT_TIMESTAMP),
  ('og_meat_portions', 'ADDON', 'C', 'Мясо (порции)', NULL, NULL, 270, CURRENT_TIMESTAMP),
  ('og_dish_extras', 'ADDON', 'C', 'Добавить в блюдо', NULL, NULL, 280, CURRENT_TIMESTAMP),
  ('og_dips', 'ADDON', 'C', 'Соусы-дипы', NULL, NULL, 290, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "OptionItem" ("id", "groupId", "name", "note", "isDefault", "minQty", "maxQty", "defaultQty", "sortOrder", "updatedAt") VALUES
  ('oi_coffee_size_s', 'og_coffee_size', 'S', '150–250 мл', FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_coffee_size_m', 'og_coffee_size', 'M', '300–350 мл', FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_coffee_size_l', 'og_coffee_size', 'L', '400–450 мл', FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_coffee_size_xl', 'og_coffee_size', 'XL', '500–550 мл', FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_serving_hot', 'og_serving', 'Горячий', NULL, TRUE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_serving_cold', 'og_serving', 'Холодный', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_espresso_ristretto', 'og_espresso', 'Ристретто', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_espresso_espresso', 'og_espresso', 'Эспрессо', NULL, TRUE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_espresso_doppio', 'og_espresso', 'Доппио', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_espresso_lungo', 'og_espresso', 'Лунго', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_decaf_decaf', 'og_decaf', 'Без кофеина', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_milk_cow', 'og_milk', 'Коровье', NULL, TRUE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_milk_lactose_free', 'og_milk', 'Безлактозное', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_milk_oat', 'og_milk', 'Овсяное', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_milk_coconut', 'og_milk', 'Кокосовое', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_milk_almond', 'og_milk', 'Миндальное', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_milk_soy', 'og_milk', 'Соевое', NULL, FALSE, NULL, NULL, NULL, 60, CURRENT_TIMESTAMP),
  ('oi_milk_banana', 'og_milk', 'Банановое', NULL, FALSE, NULL, NULL, NULL, 70, CURRENT_TIMESTAMP),
  ('oi_milk_hazelnut', 'og_milk', 'Фундучное', NULL, FALSE, NULL, NULL, NULL, 80, CURRENT_TIMESTAMP),
  ('oi_milk_rice', 'og_milk', 'Рисовое', NULL, FALSE, NULL, NULL, NULL, 90, CURRENT_TIMESTAMP),
  ('oi_milk_skimmed', 'og_milk', 'Обезжиренное', NULL, FALSE, NULL, NULL, NULL, 100, CURRENT_TIMESTAMP),
  ('oi_syrups_vanilla', 'og_syrups', 'Ваниль', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_syrups_caramel', 'og_syrups', 'Карамель', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_syrups_salted_caramel', 'og_syrups', 'Солёная карамель', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_syrups_hazelnut', 'og_syrups', 'Лесной орех', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_syrups_coconut', 'og_syrups', 'Кокос', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_syrups_almond', 'og_syrups', 'Миндаль', NULL, FALSE, NULL, NULL, NULL, 60, CURRENT_TIMESTAMP),
  ('oi_syrups_chocolate', 'og_syrups', 'Шоколад', NULL, FALSE, NULL, NULL, NULL, 70, CURRENT_TIMESTAMP),
  ('oi_syrups_banana', 'og_syrups', 'Банан', NULL, FALSE, NULL, NULL, NULL, 80, CURRENT_TIMESTAMP),
  ('oi_syrups_macadamia', 'og_syrups', 'Макадамия', NULL, FALSE, NULL, NULL, NULL, 90, CURRENT_TIMESTAMP),
  ('oi_syrups_pistachio', 'og_syrups', 'Фисташка', NULL, FALSE, NULL, NULL, NULL, 100, CURRENT_TIMESTAMP),
  ('oi_syrups_white_chocolate', 'og_syrups', 'Белый шоколад', NULL, FALSE, NULL, NULL, NULL, 110, CURRENT_TIMESTAMP),
  ('oi_syrups_irish_cream', 'og_syrups', 'Ирландский крем', NULL, FALSE, NULL, NULL, NULL, 120, CURRENT_TIMESTAMP),
  ('oi_syrups_creme_brulee', 'og_syrups', 'Крем-брюле', NULL, FALSE, NULL, NULL, NULL, 130, CURRENT_TIMESTAMP),
  ('oi_syrups_amaretto', 'og_syrups', 'Амаретто', NULL, FALSE, NULL, NULL, NULL, 140, CURRENT_TIMESTAMP),
  ('oi_syrups_raspberry', 'og_syrups', 'Малина', NULL, FALSE, NULL, NULL, NULL, 150, CURRENT_TIMESTAMP),
  ('oi_syrups_strawberry', 'og_syrups', 'Клубника', NULL, FALSE, NULL, NULL, NULL, 160, CURRENT_TIMESTAMP),
  ('oi_syrups_cherry', 'og_syrups', 'Вишня', NULL, FALSE, NULL, NULL, NULL, 170, CURRENT_TIMESTAMP),
  ('oi_syrups_blueberry', 'og_syrups', 'Черника', NULL, FALSE, NULL, NULL, NULL, 180, CURRENT_TIMESTAMP),
  ('oi_syrups_passion_fruit', 'og_syrups', 'Маракуйя', NULL, FALSE, NULL, NULL, NULL, 190, CURRENT_TIMESTAMP),
  ('oi_syrups_mint', 'og_syrups', 'Мята', NULL, FALSE, NULL, NULL, NULL, 200, CURRENT_TIMESTAMP),
  ('oi_syrups_cinnamon', 'og_syrups', 'Корица', NULL, FALSE, NULL, NULL, NULL, 210, CURRENT_TIMESTAMP),
  ('oi_syrups_lavender', 'og_syrups', 'Лаванда', NULL, FALSE, NULL, NULL, NULL, 220, CURRENT_TIMESTAMP),
  ('oi_syrups_popcorn', 'og_syrups', 'Попкорн', NULL, FALSE, NULL, NULL, NULL, 230, CURRENT_TIMESTAMP),
  ('oi_syrups_pumpkin', 'og_syrups', 'Тыква (сезонный)', NULL, FALSE, NULL, NULL, NULL, 240, CURRENT_TIMESTAMP),
  ('oi_syrups_gingerbread', 'og_syrups', 'Имбирный пряник (сезонный)', NULL, FALSE, NULL, NULL, NULL, 250, CURRENT_TIMESTAMP),
  ('oi_syrups_vanilla_sugar_free', 'og_syrups', 'Ваниль без сахара', NULL, FALSE, NULL, NULL, NULL, 260, CURRENT_TIMESTAMP),
  ('oi_syrups_caramel_sugar_free', 'og_syrups', 'Карамель без сахара', NULL, FALSE, NULL, NULL, NULL, 270, CURRENT_TIMESTAMP),
  ('oi_topping_sauce_caramel', 'og_topping_sauce', 'Карамельный', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_topping_sauce_chocolate', 'og_topping_sauce', 'Шоколадный', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_topping_sauce_salted_caramel', 'og_topping_sauce', 'Солёная карамель', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_topping_sauce_pistachio', 'og_topping_sauce', 'Фисташковый', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_topping_sauce_condensed_milk', 'og_topping_sauce', 'Сгущённое молоко', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_topping_sauce_coconut_condensed_milk', 'og_topping_sauce', 'Кокосовое сгущённое молоко', NULL, FALSE, NULL, NULL, NULL, 60, CURRENT_TIMESTAMP),
  ('oi_sprinkles_cocoa', 'og_sprinkles', 'Какао', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_sprinkles_chocolate_crumb', 'og_sprinkles', 'Шоколадная крошка', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_sprinkles_coconut_flakes', 'og_sprinkles', 'Кокосовая стружка', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_sprinkles_almond_flakes', 'og_sprinkles', 'Миндальные лепестки', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_sprinkles_pine_nut', 'og_sprinkles', 'Кедровый орех', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_sprinkles_pistachio_crumb', 'og_sprinkles', 'Фисташковая крошка', NULL, FALSE, NULL, NULL, NULL, 60, CURRENT_TIMESTAMP),
  ('oi_sprinkles_cookie_crumb', 'og_sprinkles', 'Печенье-крошка', NULL, FALSE, NULL, NULL, NULL, 70, CURRENT_TIMESTAMP),
  ('oi_foam_top_cream', 'og_foam_top', 'Сливочная', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_foam_top_protein', 'og_foam_top', 'Протеиновая', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_foam_top_chocolate', 'og_foam_top', 'Шоколадная', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_cream', 'og_coffee_extras', 'Сливки', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_cinnamon', 'og_coffee_extras', 'Корица', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_whipped_cream', 'og_coffee_extras', 'Взбитые сливки', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_marshmallow', 'og_coffee_extras', 'Маршмеллоу', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_honey', 'og_coffee_extras', 'Мёд', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_cane_sugar', 'og_coffee_extras', 'Тростниковый сахар', NULL, FALSE, NULL, NULL, NULL, 60, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_stevia', 'og_coffee_extras', 'Сахарозаменитель (стевия)', NULL, FALSE, NULL, NULL, NULL, 70, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_lemon', 'og_coffee_extras', 'Лимон', NULL, FALSE, NULL, NULL, NULL, 80, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_fresh_mint', 'og_coffee_extras', 'Мята (свежая)', NULL, FALSE, NULL, NULL, NULL, 90, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_double_milk', 'og_coffee_extras', 'Двойное молоко', NULL, FALSE, NULL, NULL, NULL, 100, CURRENT_TIMESTAMP),
  ('oi_coffee_extras_milk_on_side', 'og_coffee_extras', 'Молоко отдельно', NULL, FALSE, NULL, NULL, NULL, 110, CURRENT_TIMESTAMP),
  ('oi_sugar_sugar', 'og_sugar', 'Сахар', NULL, FALSE, 0, 3, 0, 10, CURRENT_TIMESTAMP),
  ('oi_ice_ice', 'og_ice', 'Лёд', NULL, FALSE, 0, 3, 0, 10, CURRENT_TIMESTAMP),
  ('oi_extra_shot_extra_shot', 'og_extra_shot', 'Доп. шот эспрессо', NULL, FALSE, 0, 3, 0, 10, CURRENT_TIMESTAMP),
  ('oi_burger_size_standard', 'og_burger_size', 'Стандарт', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_burger_size_large', 'og_burger_size', 'Большой', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_shawarma_size_standard', 'og_shawarma_size', 'Стандарт', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_shawarma_size_large', 'og_shawarma_size', 'Большая', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_hotdog_size_single', 'og_hotdog_size', 'Одинарный', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_hotdog_size_double', 'og_hotdog_size', 'Двойной', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_fries_portion_s', 'og_fries_portion', 'S', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_fries_portion_m', 'og_fries_portion', 'M', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_fries_portion_l', 'og_fries_portion', 'L', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_nuggets_portion_6', 'og_nuggets_portion', '6 шт', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_nuggets_portion_9', 'og_nuggets_portion', '9 шт', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_nuggets_portion_20', 'og_nuggets_portion', '20 шт', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_strips_portion_3', 'og_strips_portion', '3 шт', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_strips_portion_5', 'og_strips_portion', '5 шт', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_wings_portion_3', 'og_wings_portion', '3 шт', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_wings_portion_6', 'og_wings_portion', '6 шт', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_wings_portion_18', 'og_wings_portion', '18 шт', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_drink_size_03', 'og_drink_size', '0,3 л', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_drink_size_04', 'og_drink_size', '0,4 л', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_drink_size_05', 'og_drink_size', '0,5 л', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_base_lavash', 'og_base', 'Лаваш', NULL, TRUE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_base_cheese_lavash', 'og_base', 'Сырный лаваш', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_base_pita', 'og_base', 'Пита', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_base_bun', 'og_base', 'Булка', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_base_plate', 'og_base', 'На тарелке', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_meat_chicken', 'og_meat', 'Курица', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_meat_pork', 'og_meat', 'Свинина', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_meat_beef', 'og_meat', 'Говядина', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_meat_falafel', 'og_meat', 'Фалафель', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_spicy_spicy', 'og_spicy', 'Острый', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_garlic', 'og_dish_sauce', 'Чесночный', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_cheese', 'og_dish_sauce', 'Сырный', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_ketchup', 'og_dish_sauce', 'Кетчуп', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_bbq', 'og_dish_sauce', 'Барбекю', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_sweet_sour', 'og_dish_sauce', 'Кисло-сладкий', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_chili', 'og_dish_sauce', 'Острый (чили)', NULL, FALSE, NULL, NULL, NULL, 60, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_mayo', 'og_dish_sauce', 'Майонез', NULL, FALSE, NULL, NULL, NULL, 70, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_mustard', 'og_dish_sauce', 'Горчичный', NULL, FALSE, NULL, NULL, NULL, 80, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_adjika', 'og_dish_sauce', 'Аджика', NULL, FALSE, NULL, NULL, NULL, 90, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_white_house', 'og_dish_sauce', 'Белый фирменный', NULL, FALSE, NULL, NULL, NULL, 100, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_red_house', 'og_dish_sauce', 'Красный фирменный', NULL, FALSE, NULL, NULL, NULL, 110, CURRENT_TIMESTAMP),
  ('oi_dish_sauce_teriyaki', 'og_dish_sauce', 'Терияки', NULL, FALSE, NULL, NULL, NULL, 120, CURRENT_TIMESTAMP),
  ('oi_remove_ingredient_no_onion', 'og_remove_ingredient', 'Без лука', NULL, FALSE, NULL, NULL, NULL, 10, CURRENT_TIMESTAMP),
  ('oi_remove_ingredient_no_pickles', 'og_remove_ingredient', 'Без огурцов', NULL, FALSE, NULL, NULL, NULL, 20, CURRENT_TIMESTAMP),
  ('oi_remove_ingredient_no_tomatoes', 'og_remove_ingredient', 'Без помидоров', NULL, FALSE, NULL, NULL, NULL, 30, CURRENT_TIMESTAMP),
  ('oi_remove_ingredient_no_cabbage', 'og_remove_ingredient', 'Без капусты', NULL, FALSE, NULL, NULL, NULL, 40, CURRENT_TIMESTAMP),
  ('oi_remove_ingredient_no_sauce', 'og_remove_ingredient', 'Без соуса', NULL, FALSE, NULL, NULL, NULL, 50, CURRENT_TIMESTAMP),
  ('oi_meat_portions_meat', 'og_meat_portions', 'Мясо / котлета', NULL, FALSE, 1, 2, 1, 10, CURRENT_TIMESTAMP),
  ('oi_dish_extras_cheese', 'og_dish_extras', 'Сыр', NULL, FALSE, 0, 2, 0, 10, CURRENT_TIMESTAMP),
  ('oi_dish_extras_bacon', 'og_dish_extras', 'Бекон', NULL, FALSE, 0, 2, 0, 20, CURRENT_TIMESTAMP),
  ('oi_dish_extras_jalapeno', 'og_dish_extras', 'Халапеньо', NULL, FALSE, 0, 2, 0, 30, CURRENT_TIMESTAMP),
  ('oi_dish_extras_fries_inside', 'og_dish_extras', 'Картофель фри внутри', NULL, FALSE, 0, 2, 0, 40, CURRENT_TIMESTAMP),
  ('oi_dish_extras_mushrooms', 'og_dish_extras', 'Грибы', NULL, FALSE, 0, 2, 0, 50, CURRENT_TIMESTAMP),
  ('oi_dish_extras_pickled_onion', 'og_dish_extras', 'Маринованный лук', NULL, FALSE, 0, 2, 0, 60, CURRENT_TIMESTAMP),
  ('oi_dish_extras_korean_carrot', 'og_dish_extras', 'Корейская морковь', NULL, FALSE, 0, 2, 0, 70, CURRENT_TIMESTAMP),
  ('oi_dish_extras_pickles', 'og_dish_extras', 'Маринованные огурцы', NULL, FALSE, 0, 2, 0, 80, CURRENT_TIMESTAMP),
  ('oi_dips_ketchup', 'og_dips', 'Кетчуп', NULL, FALSE, 0, 5, 0, 10, CURRENT_TIMESTAMP),
  ('oi_dips_cheese', 'og_dips', 'Сырный', NULL, FALSE, 0, 5, 0, 20, CURRENT_TIMESTAMP),
  ('oi_dips_bbq', 'og_dips', 'Барбекю', NULL, FALSE, 0, 5, 0, 30, CURRENT_TIMESTAMP),
  ('oi_dips_sweet_sour', 'og_dips', 'Кисло-сладкий', NULL, FALSE, 0, 5, 0, 40, CURRENT_TIMESTAMP),
  ('oi_dips_garlic', 'og_dips', 'Чесночный', NULL, FALSE, 0, 5, 0, 50, CURRENT_TIMESTAMP),
  ('oi_dips_spicy', 'og_dips', 'Острый', NULL, FALSE, 0, 5, 0, 60, CURRENT_TIMESTAMP),
  ('oi_dips_mustard', 'og_dips', 'Горчичный', NULL, FALSE, 0, 5, 0, 70, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- show_if: «Пенка-топ» and «Лёд» only with «Подача = Холодный».
UPDATE "OptionGroup" SET "showIfOptionId" = 'oi_serving_cold' WHERE "id" = 'og_foam_top' AND "showIfOptionId" IS NULL;
UPDATE "OptionGroup" SET "showIfOptionId" = 'oi_serving_cold' WHERE "id" = 'og_ice' AND "showIfOptionId" IS NULL;
