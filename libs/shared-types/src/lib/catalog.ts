/**
 * Catalog transport types shared between apps/api, web, tma, admin.
 */

import type { PickupPointType } from './shared-types';

export type StoreStatus = 'OPEN' | 'CLOSED' | 'OVERLOADED';
export type StoreFulfillment = 'TAKEAWAY' | 'DINE_IN' | 'DRIVE_THRU' | 'DELIVERY';
export type VariationType = 'SIZE' | 'TEMPERATURE' | 'MILK' | 'CUP';
export type DietTag = 'VEGAN' | 'VEGETARIAN' | 'GLUTEN_FREE' | 'LACTOSE_FREE' | 'DECAF' | 'SUGAR_FREE';
export type StoreKind = 'COFFEE' | 'FOOD';

/** Every store kind, in the order the admin and the filters list them. */
export const STORE_KINDS: readonly StoreKind[] = ['COFFEE', 'FOOD'];

/**
 * What a menu category holds. Decides which fields the product editor
 * shows (caffeine for drinks, allergens for food), which ready-made option
 * sets the admin offers (see `OPTION_PRESETS`) and which placeholder a
 * product without a photo gets. OTHER shows everything and offers no set.
 */
export type CategoryKind = 'HOT_DRINKS' | 'COLD_DRINKS' | 'FOOD' | 'BAKERY' | 'OTHER';

/** Every category kind, in the order the admin lists them. */
export const CATEGORY_KINDS: readonly CategoryKind[] = ['HOT_DRINKS', 'COLD_DRINKS', 'FOOD', 'BAKERY', 'OTHER'];

/**
 * The usual preparation time of one item of a kind, in seconds — what the
 * admin suggests as the category's default (a cappuccino takes 3 minutes, a
 * shawarma 15). OTHER has no suggestion.
 */
export const CATEGORY_KIND_PREP_SECONDS: Readonly<Record<CategoryKind, number | null>> = {
  HOT_DRINKS: 3 * 60,
  COLD_DRINKS: 4 * 60,
  FOOD: 15 * 60,
  BAKERY: 2 * 60,
  OTHER: null,
};

export type { PickupPointType };

export interface StoreListItem {
  id: string;
  brandId: string;
  /** Name of the business the store belongs to. Absent from older API builds. */
  brandName?: string;
  /**
   * The brand's logo. The store's own photo is `heroImageUrl`; a card shows
   * this one only when the store has none: `heroImageUrl ?? logoUrl`.
   */
  logoUrl?: string | null;
  slug: string;
  name: string;
  addressLine: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  status: StoreStatus;
  fulfillmentTypes: StoreFulfillment[];
  pickupPointType: PickupPointType;
  busyMeter: number;
  currentEtaSeconds: number;
  /**
   * The store takes orders at all: not closed, and staff have started a shift
   * ("Start work"). When false the store is shown as inactive and checkout is
   * refused with STORE_NOT_TAKING_ORDERS. Optional for older API builds.
   */
  acceptingOrders?: boolean;
  /**
   * An ASAP order placed now would be accepted. The shift is the source of
   * truth: same as `acceptingOrders` — not closed and a shift is open —
   * whatever the working hours say. Hours only decide which slots are
   * offered for scheduled (later) pickup.
   */
  openNow: boolean;
  /** Sales tax in basis points: 500 = 5%, 2000 = 20%. */
  taxRateBps: number;
  /** True when the listed prices already include the tax. */
  taxIncludedInPrice: boolean;
  currency: string;
  /** IANA zone. Pickup and opening times are shown on the store's clock. */
  timezone: string;
  heroImageUrl: string | null;
  /** What the store sells, for map markers and filters. Missing or empty = coffee. */
  kinds?: StoreKind[];
  distanceMeters: number | null;
}

/**
 * One 15-minute handover window. Full slots still come back, marked
 * unavailable, so checkout can grey them out — a missing time reads as a
 * bug, a greyed-out one reads as a busy morning.
 */
export interface PickupSlot {
  startsAt: string;
  endsAt: string;
  taken: number;
  capacity: number;
  available: boolean;
}

export interface StoreWorkingHour {
  weekday: number;
  opensAt: number;
  closesAt: number;
  isClosed: boolean;
}

export interface BrandTheme {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  /** CSS-variable overrides applied on top of the Telegram theme. */
  themeOverrides: Record<string, string> | null;
}

export interface StoreDetail extends StoreListItem {
  phone: string | null;
  email: string | null;
  minOrderCents: number;
  galleryUrls: string[];
  workingHours: StoreWorkingHour[];
  brand: BrandTheme;
}

export interface Variation {
  id: string;
  type: VariationType;
  name: string;
  priceDeltaCents: number;
  prepTimeDeltaSeconds: number;
  sortOrder: number;
  isDefault: boolean;
}

/** Longest add-on group label («Сиропы», «Убрать»): fits one line on a phone. */
export const MODIFIER_GROUP_MAX_LENGTH = 40;

export interface Modifier {
  id: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
  prepTimeDeltaSeconds: number;
  minCount: number;
  maxCount: number;
  sortOrder: number;
  /**
   * The group the add-on is shown under on the product screen («Сиропы»,
   * «Соусы», «Убрать»). Null or missing = the generic «Добавки» group.
   * Add-ons of one group sit together, in `sortOrder`.
   */
  group?: string | null;
}

export interface ProductSummary {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  prepTimeSeconds: number;
  caffeineLevel: number | null;
  calories: number | null;
  proteinsGrams: number | null;
  fatsGrams: number | null;
  carbsGrams: number | null;
  allergens: string[];
  dietTags: DietTag[];
  imageUrls: string[];
  sortOrder: number;
  onStopList?: boolean;
  /**
   * The kind of the product's category, so a product fetched on its own
   * (deep link, favourites) still picks the right placeholder and labels.
   * Missing from older API builds: treat as OTHER.
   */
  categoryKind?: CategoryKind;
}

export interface ProductDetail extends ProductSummary {
  /** Brand that owns this product — only a store of this brand can make it. */
  brandId: string;
  variations: Variation[];
  modifiers: Modifier[];
}

export interface CategoryWithProducts {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  sortOrder: number;
  availableFrom: number | null;
  availableTo: number | null;
  /** What the category holds. Missing from older API builds: treat as OTHER. */
  kind?: CategoryKind;
  products: ProductSummary[];
}

export interface StoreMenu {
  storeId: string;
  storeSlug: string;
  categories: CategoryWithProducts[];
}

export interface ListStoresQuery {
  lat?: number;
  lng?: number;
  radius?: number;
}
