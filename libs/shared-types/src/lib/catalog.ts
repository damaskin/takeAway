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
  /**
   * Always null: every brand shows in the one takeAway style since
   * 2026-10-11, and no client applies brand colours any more.
   */
  themeOverrides: null;
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

export interface Modifier {
  id: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
  prepTimeDeltaSeconds: number;
  minCount: number;
  maxCount: number;
  sortOrder: number;
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
