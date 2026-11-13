# Options catalog («Добавки и варианты»)

Maxim's list 5.0, item 17. Source spec: `D:\MyWorks\personal\_materials\takeAway\2026-11-05_maxim-list-5.0\specs\modifiers_tz.txt`
(+ `modifiers_coffee.txt`, `modifiers_fastfood.txt`). Maxim's answers of 2026-11-06 override it where they differ.

## Decisions

| Topic                                                    | Spec                                                 | Decided                                                                                                                                                                                              | Why                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Who creates groups and options                           | platform admin                                       | SUPER_ADMIN only                                                                                                                                                                                     | spec + answer 4                                                                                   |
| Add-on price                                             | per venue                                            | **one per brand** (`BrandOptionSetting.priceCents`)                                                                                                                                                  | answer 8                                                                                          |
| Variant price                                            | per venue per option («цена товара в этом варианте») | **per product**: what the variant adds to the product's base price (`ProductOptionOverride.priceCents`, may be < 0); the base price is the default variant's                                         | a latte M and a cappuccino M cost different money; one size price per brand cannot express a menu |
| Brand hides an option it does not have                   | per venue (`enabled`)                                | per brand (`BrandOptionSetting.enabled`)                                                                                                                                                             | answer 8: per store only availability                                                             |
| Out of stock                                             | per venue (`available`)                              | per store (`StoreOptionStop`, optional `expiresAt`)                                                                                                                                                  | answer 8                                                                                          |
| A dish's signature sauce as the default                  | per dish                                             | per product (`ProductOptionOverride.isDefault`)                                                                                                                                                      | spec §7 «по умолчанию фирменный соус блюда»                                                       |
| Prep time                                                | —                                                    | options add none (queue policy reads the product's B only)                                                                                                                                           |                                                                                                   |
| Poster modifiers                                         | —                                                    | not imported any more                                                                                                                                                                                | answer 10                                                                                         |
| Old per-product options                                  | —                                                    | keep working for products with no catalog group; a product with groups is ordered through them only; SUPER_ADMIN clears a brand's old options with one action — **on prod only with the owner's OK** | answer 9                                                                                          |
| show_if when the condition's group is not on the product | —                                                    | the group is always shown (a cola has no «Подача», its «Лёд» shows)                                                                                                                                  | one «Лёд» group for coffee and fast food (spec §7)                                                |
| D type                                                   | reserved                                             | in the enums, refused by the API                                                                                                                                                                     | spec §3                                                                                           |

## Data model (Prisma)

- `OptionGroup` — catalog group: `kind` VARIANT|ADDON, `type` A|B|C|D, `name` (unique), `minSelect`/`maxSelect` (A only), `showIfOptionId` → `OptionItem` (SetNull), `sortOrder`.
- `OptionItem` — catalog option: `groupId` (Cascade), `name` (unique in the group), `note` («300–350 мл»), `isDefault`, `minQty`/`maxQty`/`defaultQty` (C only), `sortOrder`.
- `BrandOptionSetting` (brandId, optionId) — `priceCents` (ADDON; not read for VARIANT), `enabled`. **No row = enabled at price 0.**
- `StoreOptionStop` (storeId, optionId) — `expiresAt?`; active while `expiresAt` is null or in the future.
- `ProductOptionGroup` (productId, groupId) — attached groups, `sortOrder`. Group delete is Restrict.
- `ProductOptionOverride` (productId, optionId) — `priceCents?` (VARIANT: added to the base price), `isDefault?` (A/B).
- `CartItem.optionsJson` — `[{ optionId, qty }]` sorted by option id.
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
2. Each group's options in `sortOrder`, leaving out those the brand switched off (`BrandOptionSetting.enabled = false`).
3. `priceCents`: VARIANT → the product's override `priceCents ?? 0`; ADDON → the brand's `priceCents ?? 0`.
4. `isDefault`: the product's override `isDefault ?? option.isDefault`.
5. `available`: no active `StoreOptionStop` for the store (without a store — a product fetched on its own — true).
6. Groups left with no options are left out, and so is a group whose condition is an option the brand switched off while that option's group is on the product (otherwise «Лёд» would show on every hot drink once «Холодный» is off).

## API

Public:

- `GET /stores/:idOrSlug/menu` — `ProductSummary.hasRequiredOptions` = `needsOptionChoice(groups)`.
- Product detail — `ProductDetail.optionGroups` (built as above); when non-empty, `variations` and `modifiers` are `[]`.
- Cart add/update — `options?: OptionSelection[]`. For a product with groups: `options` omitted → `defaultOptionPicks`, and 400 `OPTIONS_REQUIRED` when that is not valid; invalid → 400 `OPTIONS_INVALID` (`OptionsErrorBody`); legacy `variationIds`/`modifiers` ignored. Unit price = `priceWithOptionPicks`; prep = the product's. Cart line `options: OptionLine[]`. Same product + same `optionSelectionKey` + same notes → one line.
- `PATCH /cart/items/:id`: `options` re-chooses (checked and priced as on add, no merge with an identical line); **omitted, the line keeps its choice**, re-priced against the menu as it is now, never reset or refused (a choice that can no longer be made is caught at checkout).
- Cart recheck and `POST /orders` (409 `CART_CHANGED`): an option gone (switched off, stopped, deleted, its group detached) → `OPTION_UNAVAILABLE`, the line leaves the cart; a new price → `PRICE_CHANGED`.
- Order snapshot `optionLines`; KDS, receipts, pushes and the admin order detail read `describeOrderItemOptions`.
- POS push: catalog options are not sent as Poster modifiers; the line's comment carries `describeOptionLines`.

Admin (SUPER_ADMIN):

- `GET /admin/option-groups` → `CatalogGroup[]` (with `productCount`); `POST /admin/option-groups`; `PATCH /admin/option-groups/:id`; `DELETE /admin/option-groups/:id` (409 `OPTION_GROUP_IN_USE`).
- `POST /admin/option-groups/:id/options`; `PATCH /admin/option-items/:id`; `DELETE /admin/option-items/:id`.
- `GET /admin/brands/:brandId/legacy-options` → `LegacyOptionsSummary`; `POST /admin/brands/:brandId/legacy-options/clear` → `LegacyOptionsSummary` of what was deleted: the brand's `Variation`, `Modifier`, `CategoryOption`, `StoreIngredientStop` and `Ingredient` rows.

Admin (brand — the roles that edit the add-on library today: SUPER_ADMIN, BRAND_ADMIN, MENU_EDITOR, STORE_MANAGER, brand-scoped):

- `GET /admin/brands/:brandId/options` → `BrandOptionCatalog`; `PATCH /admin/brands/:brandId/options/:optionId` `{ priceCents?, enabled? }`.
- `GET /admin/stores/:id/availability` also lists `options`: the catalog options the store uses (their group is on a product sold there) and the brand has, with their stop — the stop-list of kitchen STAFF and PIN sessions, who cannot read the brand catalog.
- `PUT /admin/stores/:storeId/option-stops/:optionId` `{ expiresAt?: string | null }`, `DELETE` the same — the roles that stop ingredients in a store today.
- `GET`/`PUT /admin/products/:id/option-groups` → `ProductOptionGroupsConfig` — the roles that edit products. 400 `OPTION_NOT_ON_PRODUCT` for an override of an option outside the attached groups; `priceCents` on an ADDON option is refused (400 `OPTION_GROUP_INVALID`).

## Seed (spec §7)

Loaded by the migration that creates the tables, with fixed ids, so every environment has the same catalog (inserting is safe on prod). Sizes are split into name + note («M» + «300–350 мл»); other names as written. «Лёд» is one group (coffee position). No catalog default for «Соус в блюдо» (per product).

Migration `20261113100000_option_espresso_strength` (Maxim, 2026-11-12) renames `og_espresso` «Эспрессо» to «Крепость» and gives the shots hints: Ристретто «крепче, меньше объём», Эспрессо «классика» (default), Доппио «двойная порция», Лунго «мягче, больше объём» — skipped where takeAway already renamed the group or wrote a hint.

## Out of scope

Combo sets, pizza, type D (spec §9). Migrating old options into the catalog automatically (answer 9: delete, then attach anew).
