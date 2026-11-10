/**
 * Options catalog («Добавки и варианты», Maxim's list 5.0 item 17).
 *
 * One catalog of option groups for the whole platform, kept by the takeAway
 * team (SUPER_ADMIN). A brand never creates groups or options: it attaches
 * catalog groups to its products, sets the price of each add-on once for
 * the whole brand, switches off what it does not have, and a store stops
 * what has run out. See `docs/option-groups.md`.
 *
 * Lives next to the older per-product options (`Variation`, `Modifier`): a
 * product with catalog groups attached is ordered through them only, a
 * product without them keeps its older options until the brand's are
 * cleared.
 */

/**
 * - `VARIANT` changes the product itself and its price: size, serving, base,
 *   meat. A product with a variant group cannot be added without picking.
 * - `ADDON` goes on top of the picked variant: milk, syrup, sugar, «Без лука».
 */
export type OptionGroupKind = 'VARIANT' | 'ADDON';

/**
 * - `A` — pick from a list: one (radio) when `maxSelect` is 1, several up to
 *   `maxSelect` (checkboxes) otherwise, at least `minSelect`;
 * - `B` — a yes/no switch on every option;
 * - `C` — a −/+ counter on every option, `minQty`…`maxQty`, starting at
 *   `defaultQty`; 0 = left out;
 * - `D` — reserved, never created (the API refuses it).
 */
export type OptionGroupType = 'A' | 'B' | 'C' | 'D';

/** Every kind, in the order a product page asks: variants first, then add-ons. */
export const OPTION_GROUP_KINDS: readonly OptionGroupKind[] = ['VARIANT', 'ADDON'];

/** The types a group can be created with (D is reserved). */
export const OPTION_GROUP_TYPES: readonly OptionGroupType[] = ['A', 'B', 'C'];

/** Longest group or option name: fits one line on a phone. */
export const OPTION_NAME_MAX_LENGTH = 60;

/** Longest option note («300–350 мл»). */
export const OPTION_NOTE_MAX_LENGTH = 60;

/** Highest count a C option may allow. */
export const OPTION_MAX_QTY_LIMIT = 20;

// ─── Public menu ────────────────────────────────────────────────────────────

/** One option of a group as a store's customers see it. */
export interface ProductOptionItem {
  id: string;
  name: string;
  /** Second line under the name («300–350 мл»), or null. */
  note: string | null;
  /**
   * A and B: picked when the product page opens. C: see `defaultQty`. The
   * product's own default wins over the catalog's (a dish's signature sauce).
   */
  isDefault: boolean;
  /** C only (null otherwise): the counter's bounds and starting value. */
  minQty: number | null;
  maxQty: number | null;
  defaultQty: number | null;
  /**
   * In the store's currency, minor units.
   * - VARIANT: what picking it adds to the product's base price, set per
   *   product (the base price is the price of the default variant, so it
   *   usually adds 0 there);
   * - ADDON A/B: its price, one for the whole brand;
   * - ADDON C: the price of one unit above `defaultQty` (the meat portion
   *   included in a shawarma is free, the second one costs this).
   */
  priceCents: number;
  /**
   * False while the store has run out of it: shown greyed out with «Нет в
   * наличии», cannot be picked. Options the brand switched off are not sent
   * at all.
   */
  available: boolean;
  sortOrder: number;
}

/** One catalog group attached to a product, as a store's customers see it. */
export interface ProductOptionGroup {
  id: string;
  kind: OptionGroupKind;
  /** Never `D`. */
  type: OptionGroupType;
  name: string;
  /**
   * A only (null for B and C): how many options may be picked. A VARIANT
   * group always asks for at least one, whatever `minSelect` says.
   */
  minSelect: number | null;
  maxSelect: number | null;
  /**
   * Shown only while this option is picked (iced coffee → «Лёд»), when that
   * option's group is on the product; when it is not (a cola has no
   * «Подача»), the group is always shown. When the condition stops holding
   * the group's picks are dropped.
   */
  showIfOptionId: string | null;
  /** Options the brand offers, in catalog order. Never empty. */
  options: ProductOptionItem[];
}

/** One pick: an option and how many of it (1 for A and B). */
export interface OptionSelection {
  optionId: string;
  qty: number;
}

/** Why a choice cannot go in the cart (see `validateOptionPicks` in `@takeaway/utils`). */
export type OptionPickErrorCode =
  /** The option is not offered on this product (another product's, switched off by the brand, or made up). */
  | 'UNKNOWN_OPTION'
  /** The store has run out of it. */
  | 'OPTION_UNAVAILABLE'
  /** Its group is hidden by its condition (ice without «Холодный»). */
  | 'HIDDEN_GROUP'
  /** Not a whole number, or more than 1 of an A or B option. */
  | 'BAD_QTY'
  /** Fewer picks than the group asks for — a variant not chosen, too little meat. */
  | 'TOO_FEW'
  /** More picks than the group allows — a third syrup, a fourth sugar. */
  | 'TOO_MANY';

export interface OptionPickError {
  code: OptionPickErrorCode;
  groupId: string | null;
  optionId: string | null;
}

/**
 * Body of the 400 the cart answers for a product with catalog groups:
 * - `OPTIONS_REQUIRED` — the request carried no `options` (a client older
 *   than the catalog) and the defaults are not a valid choice: «Обновите
 *   приложение, чтобы выбрать вариант»;
 * - `OPTIONS_INVALID` — the choice breaks a rule; `errors` says which.
 */
export interface OptionsErrorBody {
  statusCode: 400;
  error: 'Bad Request';
  code: 'OPTIONS_REQUIRED' | 'OPTIONS_INVALID';
  message: string;
  errors: OptionPickError[];
}

// ─── Orders ─────────────────────────────────────────────────────────────────

/**
 * One picked option in a cart line or an order snapshot, with the names and
 * price as they were when it was picked — a later menu edit does not move
 * an order. A type alias, not an interface, so it fits a JSON column.
 */
export type OptionLine = {
  groupId: string;
  groupName: string;
  kind: OptionGroupKind;
  type: OptionGroupType;
  optionId: string;
  name: string;
  qty: number;
  /** See {@link ProductOptionItem.priceCents}. */
  unitPriceCents: number;
  /** C only: the units included in the price. 0 for A and B. */
  freeQty: number;
  /** What it adds to one item: `unitPriceCents` for A/B, `unitPriceCents × max(0, qty − freeQty)` for C. */
  totalCents: number;
};

// ─── Admin ──────────────────────────────────────────────────────────────────

/** One catalog option (SUPER_ADMIN catalog). */
export interface CatalogOption {
  id: string;
  groupId: string;
  name: string;
  note: string | null;
  isDefault: boolean;
  minQty: number | null;
  maxQty: number | null;
  defaultQty: number | null;
  sortOrder: number;
}

/** One catalog group with its options (SUPER_ADMIN catalog). */
export interface CatalogGroup {
  id: string;
  kind: OptionGroupKind;
  type: OptionGroupType;
  name: string;
  minSelect: number | null;
  maxSelect: number | null;
  showIfOptionId: string | null;
  sortOrder: number;
  options: CatalogOption[];
  /** How many products (all brands) have it attached. Admin lists only. */
  productCount?: number;
}

/** `POST /admin/option-groups`, `PATCH /admin/option-groups/:id` (partial). */
export interface UpsertCatalogGroupRequest {
  kind: OptionGroupKind;
  type: Exclude<OptionGroupType, 'D'>;
  name: string;
  minSelect?: number | null;
  maxSelect?: number | null;
  showIfOptionId?: string | null;
  sortOrder?: number;
}

/** `POST /admin/option-groups/:id/options`, `PATCH /admin/option-items/:id` (partial). */
export interface UpsertCatalogOptionRequest {
  name: string;
  note?: string | null;
  isDefault?: boolean;
  minQty?: number | null;
  maxQty?: number | null;
  defaultQty?: number | null;
  sortOrder?: number;
}

/** A catalog option as one brand has it: its price and whether it offers it. */
export interface BrandOptionSetting {
  optionId: string;
  /** See {@link ProductOptionItem.priceCents}; ignored for VARIANT options (priced per product). */
  priceCents: number;
  /** False = the brand does not have it: hidden from its customers and its product editor. */
  enabled: boolean;
  /** Stores of the brand where it has run out right now. */
  stoppedStoreIds: string[];
}

/** `GET /admin/brands/:brandId/options`: the catalog with the brand's settings. */
export interface BrandOptionCatalog {
  groups: CatalogGroup[];
  settings: BrandOptionSetting[];
}

/** One attached group on a product, as the product editor sends and reads it. */
export interface ProductOptionGroupLink {
  groupId: string;
  sortOrder: number;
}

/** A product's own value for one option: a variant's price, a different default. */
export interface ProductOptionOverride {
  optionId: string;
  /** VARIANT options only: what picking it adds to the base price. Null = 0. */
  priceCents: number | null;
  /** A and B: the product's own default; null = the catalog's. */
  isDefault: boolean | null;
}

/** `GET`/`PUT /admin/products/:id/option-groups`. */
export interface ProductOptionGroupsConfig {
  groups: ProductOptionGroupLink[];
  overrides: ProductOptionOverride[];
}

/**
 * Error codes of the catalog admin API (409 unless noted):
 * - `OPTION_GROUP_IN_USE` — a group attached to a product cannot be deleted;
 * - `OPTION_NAME_TAKEN` — a group name is taken, or an option name within its group;
 * - `OPTION_GROUP_INVALID` (400) — type D, a VARIANT of type C, min/max on
 *   a B or C group, min above max, a C option's default outside its bounds,
 *   a condition on an option of the group itself;
 * - `OPTION_NOT_ON_PRODUCT` (400) — a product override for an option of a
 *   group the product does not have.
 */
export type OptionCatalogErrorCode =
  | 'OPTION_GROUP_IN_USE'
  | 'OPTION_NAME_TAKEN'
  | 'OPTION_GROUP_INVALID'
  | 'OPTION_NOT_ON_PRODUCT';

/**
 * What a brand still has of the older per-product options (`GET` and the
 * answer of `POST /admin/brands/:brandId/legacy-options/clear`, SUPER_ADMIN):
 * products with older options, and the rows that clearing deletes.
 */
export interface LegacyOptionsSummary {
  products: number;
  variations: number;
  modifiers: number;
  categoryOptions: number;
  ingredients: number;
}
