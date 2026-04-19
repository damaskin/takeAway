/**
 * Catalog transport types shared between apps/api, web, tma, admin, kds.
 */

import type { PickupPointType } from './shared-types';

export type StoreStatus = 'OPEN' | 'CLOSED' | 'OVERLOADED';
export type StoreFulfillment = 'TAKEAWAY' | 'DINE_IN' | 'DRIVE_THRU' | 'DELIVERY';
export type VariationType = 'SIZE' | 'TEMPERATURE' | 'MILK' | 'CUP';
export type DietTag = 'VEGAN' | 'VEGETARIAN' | 'GLUTEN_FREE' | 'LACTOSE_FREE' | 'DECAF' | 'SUGAR_FREE';

export type { PickupPointType };

export interface StoreListItem {
  id: string;
  brandId: string;
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
  currency: string;
  heroImageUrl: string | null;
  distanceMeters: number | null;
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
  timezone: string;
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
