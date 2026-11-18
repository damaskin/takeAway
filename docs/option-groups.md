# Options catalog («Добавки и варианты»)

Maxim's list 5.0, item 17. Source spec: `D:\MyWorks\personal\_materials\takeAway\2026-11-05_maxim-list-5.0\specs\modifiers_tz.txt`
(+ `modifiers_coffee.txt`, `modifiers_fastfood.txt`). Maxim's answers of 2026-11-06 override it where they differ;
his remarks of 2026-11-18 and the owner's decisions of that day (section «2026-11-18» below) override both.

Since 2026-11-18 the catalog is the **only** way a product has options: the older per-product variations and
extras, the category option sets and the brand add-on library were deleted, with their tables.

## Decisions

| Topic                                                    | Spec                                                 | Decided                                                                                                                                                      | Why                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Who creates groups and options                           | platform admin                                       | SUPER_ADMIN only                                                                                                                                             | spec + answer 4                                                                                   |
| Add-on price                                             | per venue                                            | **one per brand** (`BrandOptionSetting.priceCents`); since 2026-11-18 a product may set its own (`ProductOptionOverride.priceCents`)                         | answer 8; Maxim 2026-11-14 «split»                                                                |
| Variant price                                            | per venue per option («цена товара в этом варианте») | **per product**: what the variant adds to the product's base price (`ProductOptionOverride.priceCents`, may be < 0); the base price is the default variant's | a latte M and a cappuccino M cost different money; one size price per brand cannot express a menu |
| Brand hides an option it does not have                   | per venue (`enabled`)                                | per brand (`BrandOptionSetting.enabled`)                                                                                                                     | answer 8: per store only availability                                                             |
| Out of stock                                             | per venue (`available`)                              | per store (`StoreOptionStop`, optional `expiresAt`)                                                                                                          | answer 8                                                                                          |
| A dish's signature sauce as the default                  | per dish                                             | per product (`ProductOptionOverride.isDefault`)                                                                                                              | spec §7 «по умолчанию фирменный соус блюда»                                                       |
| Prep time                                                | —                                                    | options add none (queue policy reads the product's B only)                                                                                                   |                                                                                                   |
| Poster modifiers                                         | —                                                    | not imported any more                                                                                                                                        | answer 10                                                                                         |
| Old per-product options                                  | —                                                    | **deleted everywhere on 2026-11-18** (migration `20261118110000_drop_legacy_options`, tables dropped); order history keeps its snapshots                     | answer 9; owner 2026-11-18                                                                        |
| show_if when the condition's group is not on the product | —                                                    | the group is always shown (a cola has no «Подача», its «Лёд» shows)                                                                                          | one «Лёд» group for coffee and fast food (spec §7)                                                |
| D type                                                   | reserved                                             | in the enums, refused by the API                                                                                                                             | spec §3                                                                                           |

## Data model (Prisma)

- `OptionGroup` — catalog group: `kind` VARIANT|ADDON, `type` A|B|C|D, `name` (unique), `minSelect`/`maxSelect` (A only), `showIfOptionId` → `OptionItem` (SetNull), `scope` DRINKS|FOOD|BOTH (default BOTH), `sortOrder`.
- `OptionItem` — catalog option: `groupId` (Cascade), `name` (unique in the group), `note` («300–350 мл»), `isDefault`, `minQty`/`maxQty`/`defaultQty` (C only), `sortOrder`.
- `BrandOptionSetting` (brandId, optionId) — `priceCents` (ADDON; not read for VARIANT), `enabled`. **No row = enabled at price 0.**
- `StoreOptionStop` (storeId, optionId) — `expiresAt?`; active while `expiresAt` is null or in the future.
- `ProductOptionGroup` (productId, groupId) — attached groups, `sortOrder`. Group delete is Restrict.
- `ProductOptionOverride` (productId, optionId) — `priceCents?` (VARIANT: added to the base price, null = 0; ADDON: the product's own price instead of the brand's, null = the brand's, 0 = free here, never < 0), `isDefault?` (A/B), `enabled?` (false = switched off on this product; null = offered).
- `CartItem.optionsJson` — `[{ optionId, qty }]` sorted by option id (the cart's `variationIds` / `modifiersJson` columns were dropped on 2026-11-18).
- `OrderItem.productSnapshot.optionLines` — `OptionLine[]` (names and prices as bought).

Validation of catalog writes (400 `OPTION_GROUP_INVALID`): type D; VARIANT of type C; min/max on B or C; A with `maxSelect < 1` or `minSelect > maxSelect`; C option without `0 ≤ minQty ≤ defaultQty ≤ maxQty ≤ 20` (nulls read as 0 / 0 / 20); `showIfOptionId` of an option of the group itself.

## Rules (one implementation: `libs/utils/src/lib/option-groups.ts`)

`ProductOptionGroup[]` is what a store's customers see for a product (built by the API, see below); a choice is `OptionPicks` (option id → qty).

- `defaultOptionPicks` — available defaults of A/B (up to max), C at `defaultQty`; a required variant without a default stays unpicked.
- `toggleOptionPick` (A/B), `setOptionQty` (C) — what the product page calls on a tap; they keep the bounds and drop the picks of groups a change hides.
- `validateOptionPicks` → `OptionPickError[]`: `UNKNOWN_OPTION`, `OPTION_UNAVAILABLE`, `HIDDEN_GROUP`, `BAD_QTY`, `TOO_FEW`, `TOO_MANY`. Empty = can go in the cart. A VARIANT A group needs ≥ 1; a hidden group's requirements do not apply.
- `priceWithOptionPicks(base, groups, picks)` = base + Σ picked VARIANT and A/B add-on prices + Σ C: price × max(0, qty − defaultQty).
- `optionLinesFor` → `OptionLine[]` (cart line `options`, order snapshot `optionLines`); `describeOptionLines` → «M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2» (a C option at its included amount is not mentioned). `describeOrderItemOptions` already includes it.
- `needsOptionChoice` — the defaults are not a valid choice → a menu tile opens the product instead of adding it.
- `optionSelectionKey` — two cart lines of a product with the same key merge.

## Building a product's groups for a store (API)

1. The product's `ProductOptionGroup` rows → groups, **VARIANT first**, then by the row's `sortOrder`, then the group's `sortOrder` (`orderOptionGroups`).
2. Each group's options in `sortOrder`, leaving out those the brand switched off (`BrandOptionSetting.enabled = false`) and those the product switched off (`ProductOptionOverride.enabled = false`).
3. `priceCents`: VARIANT → the product's override `priceCents ?? 0`; ADDON → the product's override `priceCents`, else the brand's `priceCents`, else 0.
4. `isDefault`: the product's override `isDefault ?? option.isDefault`.
5. `available`: no active `StoreOptionStop` for the store (without a store — a product fetched on its own — true).
6. Groups left with no options are left out, and so is a group whose condition is an option the brand switched off while that option's group is on the product (otherwise «Лёд» would show on every hot drink once «Холодный» is off).

## Visibility rule (owner, 2026-11-18)

A product is shown to customers only if it **offers at least one variant and at least one add-on**:
`offersVariantAndAddon(groups)` in `libs/utils/src/lib/option-groups.ts`, over the product's groups as built
above — so an option the brand switched off or the product switched off does not count, and neither does a group
left without options. A store's stop does not hide the product (the option is only greyed out there), and a
show-if condition does not matter (the group is attached and offered). Applies to every category kind and to
POS-synced products (Poster) alike: a synced product appears once the brand attaches a variant and an add-on.

Enforced at read time in the API, so every client behaves the same:

- `GET /stores/:idOrSlug/menu` leaves such a product out, and a category left without products with it; the
  suggestions (`GET /stores/:id/suggestions`, «Часто берут вместе») read that menu.
- Product detail answers 404 «Product not found», as for a hidden product (with a store or without).
- Cart add answers 404 «Product not found». A quantity change of a line already in a cart is not refused.
- Checkout (`repriceForCheckout`, `POST /orders`): such a line leaves the cart with 409 `CART_CHANGED`,
  reason `PRODUCT_UNAVAILABLE`.
- Admin: `optionsComplete` on the product list and card (`ProductOptionGroupsService.offeringVariantAndAddon`,
  three queries for any number of products and brands); the card says «Не видно покупателям: добавьте хотя бы
  один вариант и одну добавку», the menu list badges the product «Не видно покупателям».
- «Запуск бренда», step «Меню»: counts only listed products that pass the rule (`listedProductCounts`).

This replaced the 2026-11-17 «allow, with a hint for a drink without a size» decision.

## Scope (Maxim, 2026-11-18)

`OptionGroup.scope`: DRINKS, FOOD or BOTH. The product editor offers a product the groups of its category's kind:
HOT_DRINKS / COLD_DRINKS → DRINKS + BOTH, FOOD / BAKERY → FOOD + BOTH, OTHER → every group
(`optionScopesFor` / `scopeFitsKind` in `libs/utils`). A group attached before keeps its place (marked «не для
этой категории»); the API does not refuse a mismatch — a category's kind can change later, nothing is lost
silently. «Добавки» and «Каталог добавок» filter Напитки / Еда / Все (a BOTH group shows under each). The seeded
groups were set by meaning in migration `20261118100000_option_scope_product_switch`: the coffee position and
`og_drink_size`, `og_sugar`, `og_ice` → DRINKS; the fast-food position (sizes, portions, base, meat, spicy,
sauces, «Убрать ингредиент», dips, extras) → FOOD; none ambiguous. SUPER_ADMIN edits it in «Каталог добавок».

## Prices (Maxim, 2026-11-14 «split», 2026-11-18)

- A variant's price is a **surcharge** set in the product card: the field starts empty; empty or 0 = no
  surcharge (the base price); a sum is added to the order. Rows written before may still hold a negative delta.
- An add-on's price is one per brand in «Добавки»; a product card may set its own (empty = the brand's, shown
  under the field; 0 = free on this product).
- «Применить ко всем» next to a price: in the card it gives every option of the group that option's price (saved
  with the card); in «Добавки» it sets the brand price of every option of an add-on group at once
  (`PUT /admin/brands/:brandId/option-groups/:groupId/price`).
- Both places show both kinds: «Добавки» lists what each variant adds in each product card and the products with
  their own add-on price, read-only («меняется в карточке товара»; `BrandOptionCatalog.productPrices`); the card
  shows the brand's add-on price under each add-on field.

## API

Public:

- `GET /stores/:idOrSlug/menu` — only products that pass the visibility rule; `ProductSummary.hasRequiredOptions` = `needsOptionChoice(groups)`.
- Product detail — `ProductDetail.optionGroups` (built as above); 404 for a product that fails the visibility rule. `variations` and `modifiers` are always `[]` (kept on the wire for app builds from before 2026-11-18).
- Cart add/update — `options?: OptionSelection[]`. `options` omitted → `defaultOptionPicks`, and 400 `OPTIONS_REQUIRED` when that is not a valid choice; invalid → 400 `OPTIONS_INVALID` (`OptionsErrorBody`); `variationIds`/`modifiers` still accepted and ignored. Cart add of a product that fails the visibility rule → 404. Unit price = `priceWithOptionPicks`; prep = the product's. Cart line `options: OptionLine[]` (`variationIds: []`, `modifiers: {}` kept on the wire). Same product + same `optionSelectionKey` + same notes → one line.
- `PATCH /cart/items/:id`: `options` re-chooses (checked and priced as on add, no merge with an identical line); **omitted, the line keeps its choice**, re-priced against the menu as it is now, never reset or refused (a choice that can no longer be made is caught at checkout).
- Cart recheck and `POST /orders` (409 `CART_CHANGED`): the product fails the visibility rule → `PRODUCT_UNAVAILABLE`; an option gone (switched off by the brand or the product, stopped, deleted, its group detached) → `OPTION_UNAVAILABLE`, the line leaves the cart; a new price → `PRICE_CHANGED`.
- Order snapshot `optionLines` (the older `variationIds` / `modifiers` / `variations` / `modifierLines` are written empty; orders placed before keep theirs); KDS, receipts, pushes and the admin order detail read `describeOrderItemOptions`.
- POS push: catalog options are not sent as Poster modifiers; the line's comment carries `describeOptionLines`.

Admin (SUPER_ADMIN):

- `GET /admin/option-groups` → `CatalogGroup[]` (with `productCount`, `scope`); `POST /admin/option-groups` (`scope` omitted = BOTH); `PATCH /admin/option-groups/:id`; `DELETE /admin/option-groups/:id` (409 `OPTION_GROUP_IN_USE`).
- `POST /admin/option-groups/:id/options`; `PATCH /admin/option-items/:id`; `DELETE /admin/option-items/:id`.
- (The legacy-options summary and «clear» endpoints were removed with the older options on 2026-11-18.)

Admin (brand — the roles that edit the add-on library today: SUPER_ADMIN, BRAND_ADMIN, MENU_EDITOR, STORE_MANAGER, brand-scoped):

- `GET /admin/brands/:brandId/options` → `BrandOptionCatalog` (with `productPrices`: every variant option of a group attached to a product of the brand with what it adds there, 0 included, and every add-on a product prices itself); `PATCH /admin/brands/:brandId/options/:optionId` `{ priceCents?, enabled? }`; `PUT /admin/brands/:brandId/option-groups/:groupId/price` `{ priceCents }` → `BrandOptionSetting[]` of the group (add-on groups only; a variant group → 400 `OPTION_GROUP_INVALID`).
- `GET /admin/stores/:id/availability` also lists `options`: the catalog options the store uses (their group is on a product sold there) and the brand has, with their stop — the stop-list of kitchen STAFF and PIN sessions, who cannot read the brand catalog.
- `PUT /admin/stores/:storeId/option-stops/:optionId` `{ expiresAt?: string | null }`, `DELETE` the same — the roles that stop ingredients in a store today.
- `GET`/`PUT /admin/products/:id/option-groups` → `ProductOptionGroupsConfig` (overrides carry `enabled`) — the roles that edit products. 400 `OPTION_NOT_ON_PRODUCT` for an override of an option outside the attached groups; a negative `priceCents` on an ADDON option → 400 `OPTION_GROUP_INVALID`. An override with nothing in it (no price, no default, `enabled` null or true) is dropped.
- `GET /admin/products`, `GET /admin/products/:id` — `optionsComplete` (see «Visibility rule»).

## Seed (spec §7)

Loaded by the migration that creates the tables, with fixed ids, so every environment has the same catalog (inserting is safe on prod). Sizes are split into name + note («M» + «300–350 мл»); other names as written. «Лёд» is one group (coffee position). No catalog default for «Соус в блюдо» (per product).

Migration `20261113100000_option_espresso_strength` (Maxim, 2026-11-12) renames `og_espresso` «Эспрессо» to «Крепость» and gives the shots hints: Ристретто «крепче, меньше объём», Эспрессо «классика» (default), Доппио «двойная порция», Лунго «мягче, больше объём» — skipped where takeAway already renamed the group or wrote a hint.

## 2026-11-18 migrations

- `20261118100000_option_scope_product_switch` — `OptionGroupScope` enum, `OptionGroup.scope` (default BOTH, the
  29 seeded groups set by meaning), `ProductOptionOverride.enabled`.
- `20261118110000_drop_legacy_options` — deletes the cart lines made with older options (a variation, or an extra
  with a count ≥ 1) and re-totals their carts (a cart left empty waits for nothing), then drops `Variation`,
  `Modifier`, `CategoryOption`, `StoreIngredientStop`, `Ingredient`, `CartItem.variationIds` /
  `CartItem.modifiersJson` and the `VariationType` / `CategoryOptionKind` enums. Order snapshots are JSON and are
  not touched. Tested with data on Postgres by `legacy-options-migration.db.spec.ts`
  (`LEGACY_MIGRATION_IT_SERVER_URL`).

## Out of scope

Combo sets, pizza, type D (spec §9). Migrating old options into the catalog automatically (answer 9: delete, then attach anew).
