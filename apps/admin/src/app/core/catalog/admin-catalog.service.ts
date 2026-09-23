import { HttpClient, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type VariationType = 'SIZE' | 'TEMPERATURE' | 'MILK' | 'CUP';
export type DietTag = 'VEGAN' | 'VEGETARIAN' | 'GLUTEN_FREE' | 'LACTOSE_FREE' | 'DECAF' | 'SUGAR_FREE';

export interface BrandDto {
  id: string;
  slug: string;
  name: string;
  currency: string;
  locale: string;
  logoUrl: string | null;
}

export interface StoreWorkingHourDto {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes since local midnight; `closesAt` 1440 is midnight at the end of the day. */
  opensAt: number;
  closesAt: number;
  isClosed: boolean;
}

export type StoreStatus = 'OPEN' | 'CLOSED' | 'OVERLOADED';
export type StoreFulfillment = 'TAKEAWAY' | 'DINE_IN' | 'DRIVE_THRU' | 'DELIVERY';
export type PickupPointType = 'COUNTER' | 'SHELF' | 'LOCKER';
export type StoreImageKind = 'hero' | 'gallery';

/** The checks a closed store has to pass before it can be opened. */
export type ReadinessCheck = 'coordinates' | 'timezone' | 'hours' | 'menu' | 'brandApproved';

export interface StoreReadinessDto {
  /** Every required check passes. */
  ready: boolean;
  items: Array<{ check: ReadinessCheck; ok: boolean; required: boolean }>;
}

export interface StoreAdminDto {
  id: string;
  brandId: string;
  slug: string;
  name: string;
  addressLine?: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  status: StoreStatus;
  currency: string;
  phone?: string | null;
  email?: string | null;
  minOrderCents?: number;
  timezone?: string;
  workingHours?: StoreWorkingHourDto[];
  fulfillmentTypes?: StoreFulfillment[];
  pickupPointType?: PickupPointType;
  baseEtaSeconds?: number;
  kitchenParallelism?: number;
  slotCapacity?: number;
  taxRateBps?: number;
  taxIncludedInPrice?: boolean;
  heroImageUrl?: string | null;
  galleryUrls?: string[];
  deliveryFeeBaseCents?: number | null;
  deliveryFeePerKmCents?: number | null;
  deliveryFreeRadiusM?: number | null;
  deliveryMaxRadiusM?: number | null;
  readiness?: StoreReadinessDto;
  /** Sent by the single-store endpoints: orders pin the currency and forbid deleting. */
  hasOrders?: boolean;
}

export interface UpdateStoreInput {
  name?: string;
  slug?: string;
  addressLine?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  currency?: string;
  phone?: string | null;
  email?: string | null;
  status?: StoreStatus;
  minOrderCents?: number;
  fulfillmentTypes?: StoreFulfillment[];
  pickupPointType?: PickupPointType;
  baseEtaSeconds?: number;
  kitchenParallelism?: number;
  slotCapacity?: number;
  taxRateBps?: number;
  taxIncludedInPrice?: boolean;
  deliveryFeeBaseCents?: number | null;
  deliveryFeePerKmCents?: number | null;
  deliveryFreeRadiusM?: number | null;
  deliveryMaxRadiusM?: number | null;
}

export interface CreateStoreInput {
  brandId: string;
  /** Generated from the brand and store name when omitted. */
  slug?: string;
  name: string;
  addressLine: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  /** The brand's currency when omitted. */
  currency?: string;
  timezone?: string;
  phone?: string;
  email?: string;
}

export interface StoreImagesDto {
  heroImageUrl: string | null;
  galleryUrls: string[];
}

export interface VariationAdminDto {
  id: string;
  type: VariationType;
  name: string;
  priceDeltaCents: number;
  prepTimeDeltaSeconds: number;
  sortOrder: number;
  isDefault: boolean;
}

export interface ModifierAdminDto {
  id: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
  prepTimeDeltaSeconds: number;
  minCount: number;
  maxCount: number;
  sortOrder: number;
}

export interface ProductDetailDto extends ProductAdminDto {
  variations: VariationAdminDto[];
  modifiers: ModifierAdminDto[];
}

export interface CreateVariationInput {
  type: VariationAdminDto['type'];
  name: string;
  priceDeltaCents?: number;
  prepTimeDeltaSeconds?: number;
  isDefault?: boolean;
  sortOrder?: number;
}

export type UpdateVariationInput = Partial<CreateVariationInput>;

export interface CreateModifierInput {
  /** Built from the name on the server when omitted. */
  slug?: string;
  name: string;
  priceDeltaCents?: number;
  prepTimeDeltaSeconds?: number;
  minCount?: number;
  maxCount?: number;
  sortOrder?: number;
}

export type UpdateModifierInput = Partial<CreateModifierInput>;

export interface CategoryAdminDto {
  id: string;
  brandId: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  visible: boolean;
  _count?: { products: number };
}

export interface ProductAdminDto {
  id: string;
  brandId: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  prepTimeSeconds: number;
  visible: boolean;
  sortOrder: number;
  /** In display order; the first one is the menu picture. */
  imageUrls: string[];
  caffeineLevel: number | null;
  calories: number | null;
  proteinsGrams: number | null;
  fatsGrams: number | null;
  carbsGrams: number | null;
  allergens: string[];
  dietTags: DietTag[];
}

export interface CreateCategoryInput {
  brandId: string;
  /** Built from the name on the server when omitted. */
  slug?: string;
  name: string;
  description?: string;
  sortOrder?: number;
  visible?: boolean;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
  sortOrder?: number;
  visible?: boolean;
}

/** What the product editor sends; `null` clears an optional value. */
export interface ProductFieldsInput {
  name: string;
  description: string | null;
  basePriceCents: number;
  prepTimeSeconds?: number;
  visible: boolean;
  caffeineLevel: number | null;
  calories: number | null;
  proteinsGrams: number | null;
  fatsGrams: number | null;
  carbsGrams: number | null;
  allergens: string[];
  dietTags: DietTag[];
}

export interface CreateProductInput extends Partial<Omit<ProductFieldsInput, 'name' | 'basePriceCents'>> {
  brandId: string;
  categoryId: string;
  /** Built from the name on the server when omitted. */
  slug?: string;
  name: string;
  basePriceCents: number;
}

export interface UpdateProductInput extends Partial<ProductFieldsInput> {
  sortOrder?: number;
  categoryId?: string;
}

export interface ProductImagesDto {
  imageUrls: string[];
}

export interface StopListEntryDto {
  id: string;
  storeId: string;
  productId: string;
  reason: string | null;
  /** ISO time the product comes back on its own; `null` = until switched back by hand. */
  expiresAt: string | null;
  createdAt: string;
}

export interface AddStopListEntryInput {
  productId: string;
  reason?: string;
  expiresAt?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminCatalogApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  listBrands(): Observable<BrandDto[]> {
    return this.http.get<BrandDto[]>(`${this.api.baseUrl}/admin/brands`);
  }

  /**
   * Brands the current user can act on. SUPER_ADMIN gets every brand;
   * BRAND_ADMIN gets owned brands; staff/managers/riders get brands that
   * own a store they're assigned to. Powers the active-brand selector.
   */
  listMyBrands(): Observable<BrandDto[]> {
    return this.http.get<BrandDto[]>(`${this.api.baseUrl}/admin/brands/mine`);
  }

  listStores(brandId?: string): Observable<StoreAdminDto[]> {
    const params = brandId ? { brandId } : undefined;
    return this.http.get<StoreAdminDto[]>(`${this.api.baseUrl}/admin/stores`, { params });
  }

  getStore(id: string): Observable<StoreAdminDto> {
    return this.http.get<StoreAdminDto>(`${this.api.baseUrl}/admin/stores/${id}`);
  }

  getProduct(id: string): Observable<ProductDetailDto> {
    return this.http.get<ProductDetailDto>(`${this.api.baseUrl}/admin/products/${id}`);
  }

  createVariation(productId: string, input: CreateVariationInput): Observable<VariationAdminDto> {
    return this.http.post<VariationAdminDto>(`${this.api.baseUrl}/admin/products/${productId}/variations`, input);
  }

  updateVariation(variationId: string, input: UpdateVariationInput): Observable<VariationAdminDto> {
    return this.http.patch<VariationAdminDto>(`${this.api.baseUrl}/admin/products/variations/${variationId}`, input);
  }

  deleteVariation(variationId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/products/variations/${variationId}`);
  }

  createModifier(productId: string, input: CreateModifierInput): Observable<ModifierAdminDto> {
    return this.http.post<ModifierAdminDto>(`${this.api.baseUrl}/admin/products/${productId}/modifiers`, input);
  }

  updateModifier(modifierId: string, input: UpdateModifierInput): Observable<ModifierAdminDto> {
    return this.http.patch<ModifierAdminDto>(`${this.api.baseUrl}/admin/products/modifiers/${modifierId}`, input);
  }

  deleteModifier(modifierId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/products/modifiers/${modifierId}`);
  }

  updateStore(id: string, input: UpdateStoreInput): Observable<StoreAdminDto> {
    return this.http.patch<StoreAdminDto>(`${this.api.baseUrl}/admin/stores/${id}`, input);
  }

  createStore(input: CreateStoreInput): Observable<StoreAdminDto> {
    return this.http.post<StoreAdminDto>(`${this.api.baseUrl}/admin/stores`, input);
  }

  deleteStore(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${id}`);
  }

  replaceWorkingHours(id: string, hours: StoreWorkingHourDto[]): Observable<StoreWorkingHourDto[]> {
    return this.http.put<StoreWorkingHourDto[]>(`${this.api.baseUrl}/admin/stores/${id}/working-hours`, { hours });
  }

  /** `hero` replaces the cover photo, `gallery` adds one to the gallery. */
  uploadStoreImage(id: string, kind: StoreImageKind, file: File): Observable<StoreImagesDto> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<StoreImagesDto>(`${this.api.baseUrl}/admin/stores/${id}/images`, body, {
      params: { kind },
    });
  }

  removeStoreImage(id: string, kind: StoreImageKind, url?: string): Observable<StoreImagesDto> {
    const params: Record<string, string> = { kind };
    if (url) params['url'] = url;
    return this.http.delete<StoreImagesDto>(`${this.api.baseUrl}/admin/stores/${id}/images`, { params });
  }

  listCategories(brandId?: string): Observable<CategoryAdminDto[]> {
    const params = brandId ? { brandId } : undefined;
    return this.http.get<CategoryAdminDto[]>(`${this.api.baseUrl}/admin/categories`, { params });
  }

  createCategory(input: CreateCategoryInput): Observable<CategoryAdminDto> {
    return this.http.post<CategoryAdminDto>(`${this.api.baseUrl}/admin/categories`, input);
  }

  updateCategory(id: string, input: UpdateCategoryInput): Observable<CategoryAdminDto> {
    return this.http.patch<CategoryAdminDto>(`${this.api.baseUrl}/admin/categories/${id}`, input);
  }

  /**
   * A category that still has products answers 409 `CATEGORY_NOT_EMPTY`
   * unless `moveProductsTo` names another category of the brand for them.
   */
  deleteCategory(id: string, moveProductsTo?: string): Observable<void> {
    const params: Record<string, string> = moveProductsTo ? { moveProductsTo } : {};
    return this.http.delete<void>(`${this.api.baseUrl}/admin/categories/${id}`, { params });
  }

  reorderCategories(orderedIds: string[]): Observable<void> {
    return this.http.patch<void>(`${this.api.baseUrl}/admin/categories/reorder`, { orderedIds });
  }

  /** Product ids of one category in their new order. */
  reorderProducts(orderedIds: string[]): Observable<void> {
    return this.http.patch<void>(`${this.api.baseUrl}/admin/products/reorder`, { orderedIds });
  }

  /** Emits upload progress events, then the product's photo list. */
  uploadProductImage(productId: string, file: File): Observable<HttpEvent<ProductImagesDto>> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<ProductImagesDto>(`${this.api.baseUrl}/admin/products/${productId}/images`, body, {
      reportProgress: true,
      observe: 'events',
    });
  }

  removeProductImage(productId: string, url: string): Observable<ProductImagesDto> {
    return this.http.delete<ProductImagesDto>(`${this.api.baseUrl}/admin/products/${productId}/images`, {
      params: { url },
    });
  }

  /** The listed photos go first, in that order; the first one is the menu picture. */
  reorderProductImages(productId: string, urls: string[]): Observable<ProductImagesDto> {
    return this.http.put<ProductImagesDto>(`${this.api.baseUrl}/admin/products/${productId}/images/order`, { urls });
  }

  listStopList(storeId: string): Observable<StopListEntryDto[]> {
    return this.http.get<StopListEntryDto[]>(`${this.api.baseUrl}/admin/stores/${storeId}/stop-list`);
  }

  addStopListEntry(storeId: string, input: AddStopListEntryInput): Observable<StopListEntryDto> {
    return this.http.post<StopListEntryDto>(`${this.api.baseUrl}/admin/stores/${storeId}/stop-list`, input);
  }

  removeStopListEntry(storeId: string, productId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${storeId}/stop-list/${productId}`);
  }

  listProducts(brandId?: string, categoryId?: string): Observable<ProductAdminDto[]> {
    const params: Record<string, string> = {};
    if (brandId) params['brandId'] = brandId;
    if (categoryId) params['categoryId'] = categoryId;
    return this.http.get<ProductAdminDto[]>(`${this.api.baseUrl}/admin/products`, { params });
  }

  createProduct(input: CreateProductInput): Observable<ProductAdminDto> {
    return this.http.post<ProductAdminDto>(`${this.api.baseUrl}/admin/products`, input);
  }

  updateProduct(id: string, input: UpdateProductInput): Observable<ProductAdminDto> {
    return this.http.patch<ProductAdminDto>(`${this.api.baseUrl}/admin/products/${id}`, input);
  }

  toggleProductVisibility(id: string, visible: boolean): Observable<ProductAdminDto> {
    return this.http.patch<ProductAdminDto>(`${this.api.baseUrl}/admin/products/${id}/visibility`, { visible });
  }

  deleteProduct(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/products/${id}`);
  }
}
