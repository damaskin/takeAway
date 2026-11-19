-- Maxim's remarks on «Добавки и Варианты» (2026-11-18), items 1 and 2.
--
-- 1. A catalog group is meant for drinks, food or both. The product editor
--    offers a drink only the DRINKS and BOTH groups, food only FOOD and
--    BOTH (OTHER categories see everything); «Добавки» and the platform
--    catalog filter by it. New and unknown groups are BOTH.
-- 2. A product switches single options of its groups off (a shawarma's
--    «Основа» without «Булка» and «Пита»): `ProductOptionOverride.enabled`.

-- CreateEnum
CREATE TYPE "OptionGroupScope" AS ENUM ('DRINKS', 'FOOD', 'BOTH');

-- AlterTable
ALTER TABLE "OptionGroup" ADD COLUMN "scope" "OptionGroupScope" NOT NULL DEFAULT 'BOTH';

-- AlterTable
ALTER TABLE "ProductOptionOverride" ADD COLUMN "enabled" BOOLEAN;

-- The seeded groups (migration 20261109120000_option_catalog) by meaning:
-- the coffee position and drink sizes are drinks («Лёд» and «Сахар» go into
-- a coffee or a cola), the fast-food position is food. Only the seeded ids
-- are touched; a group takeAway added since stays BOTH.
UPDATE "OptionGroup" AS g
SET "scope" = s.scope::"OptionGroupScope", "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('og_coffee_size', 'DRINKS'),
  ('og_serving', 'DRINKS'),
  ('og_espresso', 'DRINKS'),
  ('og_decaf', 'DRINKS'),
  ('og_milk', 'DRINKS'),
  ('og_syrups', 'DRINKS'),
  ('og_topping_sauce', 'DRINKS'),
  ('og_sprinkles', 'DRINKS'),
  ('og_foam_top', 'DRINKS'),
  ('og_coffee_extras', 'DRINKS'),
  ('og_sugar', 'DRINKS'),
  ('og_ice', 'DRINKS'),
  ('og_extra_shot', 'DRINKS'),
  ('og_drink_size', 'DRINKS'),
  ('og_burger_size', 'FOOD'),
  ('og_shawarma_size', 'FOOD'),
  ('og_hotdog_size', 'FOOD'),
  ('og_fries_portion', 'FOOD'),
  ('og_nuggets_portion', 'FOOD'),
  ('og_strips_portion', 'FOOD'),
  ('og_wings_portion', 'FOOD'),
  ('og_base', 'FOOD'),
  ('og_meat', 'FOOD'),
  ('og_spicy', 'FOOD'),
  ('og_dish_sauce', 'FOOD'),
  ('og_remove_ingredient', 'FOOD'),
  ('og_meat_portions', 'FOOD'),
  ('og_dish_extras', 'FOOD'),
  ('og_dips', 'FOOD')
) AS s(id, scope)
WHERE g."id" = s.id;
