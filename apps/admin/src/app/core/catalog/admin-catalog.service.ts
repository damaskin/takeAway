import { HttpClient, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { BrandPlan, CategoryKind, StoreKind } from '@takeaway/shared-types';

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
  /** Where the brand stands in moderation; drives the banner in the admin shell. */
  moderationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  moderationNote?: string | null;
  submittedAt?: string;
  /** Business plan; decides which sections the cabinet opens. */
  plan?: BrandPlan;
  /** Platform commission in basis points (1000 = 10 %). */
  commissionBps?: number;
  /** The number the takeAway team calls, E.164; null on a brand from before sign-up asked for it. */
  contactPhone?: string | null;
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
export type { CategoryKind, StoreKind };

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
  /** What the store sells; never empty from the API. */
  kinds?: StoreKind[];
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
  /** A shift is running: the store takes orders. Sent by the store list only. */
  shiftOpen?: boolean;
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
  kinds?: StoreKind[];
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
  /** Coffee when omitted. */
  kinds?: StoreKind[];
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
  ingredientId: string | null;
  ingredient: IngredientSummaryDto | null;
}

/** An option's ingredient as the product editor shows it. */
export interface IngredientSummaryDto {
  id: string;
  name: string;
  isAvailable: boolean;
}

/**
 * An add-on of the brand library («Добавки») — the one place it is defined:
 * name, usual price, one in-stock switch for every option made of it.
 */
export interface IngredientDto extends IngredientSummaryDto {
  brandId: string;
  /** Usual surcharge in minor units; what a product picking it from the library charges. */
  priceCents: number;
  /** Products offering it (an extra or a milk made of it). */
  products: Array<{ id: string; name: string }>;
  /** The add-on group an extra made of it starts in («Сиропы»); null = «Добавки». Missing from older APIs. */
  group?: string | null;
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
  ingredientId: string | null;
  ingredient: IngredientSummaryDto | null;
  /** Group the add-on is shown under («Сиропы», «Убрать»); null = «Добавки». Missing from older APIs. */
  group?: string | null;
}

export interface ProductDetailDto extends ProductAdminDto {
  variations: VariationAdminDto[];
  modifiers: ModifierAdminDto[];
  /** The product's category, for the choice groups that fit its kind. Missing from older APIs. */
  category?: { name: string; kind: CategoryKind };
}

export interface CreateVariationInput {
  type: VariationAdminDto['type'];
  /** May be left out with `ingredientId`: the add-on's name. */
  name?: string;
  /** Left out: the linked add-on's usual price, else 0. */
  priceDeltaCents?: number;
  prepTimeDeltaSeconds?: number;
  isDefault?: boolean;
  sortOrder?: number;
  /** Omitted on create: a milk joins the library entry of its name. `null` = not tracked. */
  ingredientId?: string | null;
}

export type UpdateVariationInput = Partial<CreateVariationInput>;

export interface CreateModifierInput {
  /** Built from the name on the server when omitted. */
  slug?: string;
  /** May be left out with `ingredientId`: the add-on's name. */
  name?: string;
  /** Left out: the linked add-on's usual price, else 0. */
  priceDeltaCents?: number;
  prepTimeDeltaSeconds?: number;
  minCount?: number;
  maxCount?: number;
  sortOrder?: number;
  /** Omitted on create: joins the library entry of its name. `null` = not tracked. */
  ingredientId?: string | null;
  /** Omitted on create: the library entry's group. `null` = «Добавки». */
  group?: string | null;
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
  /** Not sold on its own: hidden from customer menus, its products only go into drinks as add-ons. */
  addOnsOnly?: boolean;
  /** Hot drinks, food…: the fields of its products and its option presets. Missing from older APIs (= OTHER). */
  kind?: CategoryKind;
  /** Preparation time a new product of the category starts with, seconds. */
  defaultPrepTimeSeconds?: number | null;
  _count?: { products: number; options?: number };
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
  /** Stores that sell it (same price everywhere); empty = sold nowhere. */
  storeIds: string[];
}

/** A store a product can be listed in, for the product form's picker. */
export interface ProductStoreOptionDto {
  id: string;
  name: string;
  status: StoreStatus;
}

export interface CreateCategoryInput {
  brandId: string;
  /** Built from the name on the server when omitted. */
  slug?: string;
  name: string;
  description?: string;
  sortOrder?: number;
  visible?: boolean;
  addOnsOnly?: boolean;
  kind?: CategoryKind;
  defaultPrepTimeSeconds?: number | null;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
  sortOrder?: number;
  visible?: boolean;
  addOnsOnly?: boolean;
  kind?: CategoryKind;
  defaultPrepTimeSeconds?: number | null;
}

/** What an option of a category's set becomes on a product. */
export type CategoryOptionKind = 'VARIATION' | 'MODIFIER';

/** One option of a category's set («Опции категории»). */
export interface CategoryOptionDto {
  id: string;
  categoryId: string;
  kind: CategoryOptionKind;
  variationType: VariationType | null;
  name: string;
  priceDeltaCents: number;
  group: string | null;
  isDefault: boolean;
  maxCount: number;
  sortOrder: number;
  ingredientId: string | null;
  ingredient: IngredientSummaryDto | null;
}

/** An option sent to a category's set; a library add-on may be named by `ingredientId` alone. */
export interface CategoryOptionInput {
  kind: CategoryOptionKind;
  variationType?: VariationType;
  name?: string;
  ingredientId?: string | null;
  priceDeltaCents?: number;
  group?: string | null;
  isDefault?: boolean;
  maxCount?: number;
}

export interface UpdateCategoryOptionInput {
  name?: string;
  priceDeltaCents?: number;
  group?: string | null;
  isDefault?: boolean;
  maxCount?: number;
  sortOrder?: number;
}

/** What «apply to the category's products» added. */
export interface ApplyCategoryOptionsResult {
  total: number;
  products: number;
  variations: number;
  modifiers: number;
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
  /** Omitted = every store of the brand. */
  storeIds?: string[];
  /** False: no copy of the category's option set (and no category prep time). Omitted = true. */
  applyCategoryOptions?: boolean;
}

export interface UpdateProductInput extends Partial<ProductFieldsInput> {
  sortOrder?: number;
  categoryId?: string;
  /** Replaces the listing; omitted = unchanged. */
  storeIds?: string[];
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

/** A stop that still holds in the store; `expiresAt` null = until switched back by hand. */
export interface AvailabilityStopDto {
  expiresAt: string | null;
}

export interface AvailabilityProductDto {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  imageUrl: string | null;
  stop: AvailabilityStopDto | null;
}

export interface AvailabilityIngredientDto {
  id: string;
  name: string;
  /** False = switched off for the whole brand in the ingredient library. */
  isAvailable: boolean;
  stop: AvailabilityStopDto | null;
  productNames: string[];
}

/** One store's stop-list: what it sells and which add-ins it has run out of. */
export interface StoreAvailabilityDto {
  storeId: string;
  storeName: string;
  timezone: string;
  products: AvailabilityProductDto[];
  ingredients: AvailabilityIngredientDto[];
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

  listCategoryOptions(categoryId: string): Observable<CategoryOptionDto[]> {
    return this.http.get<CategoryOptionDto[]>(`${this.api.baseUrl}/admin/categories/${categoryId}/options`);
  }

  /** Appends to the set (options it has are skipped); answers the whole set. */
  addCategoryOptions(categoryId: string, options: CategoryOptionInput[]): Observable<CategoryOptionDto[]> {
    return this.http.post<CategoryOptionDto[]>(`${this.api.baseUrl}/admin/categories/${categoryId}/options`, {
      options,
    });
  }

  updateCategoryOption(
    categoryId: string,
    optionId: string,
    input: UpdateCategoryOptionInput,
  ): Observable<CategoryOptionDto[]> {
    return this.http.patch<CategoryOptionDto[]>(
      `${this.api.baseUrl}/admin/categories/${categoryId}/options/${optionId}`,
      input,
    );
  }

  deleteCategoryOption(categoryId: string, optionId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/categories/${categoryId}/options/${optionId}`);
  }

  /** Copies what each product of the category lacks from its set. */
  applyCategoryOptions(categoryId: string): Observable<ApplyCategoryOptionsResult> {
    return this.http.post<ApplyCategoryOptionsResult>(
      `${this.api.baseUrl}/admin/categories/${categoryId}/options/apply`,
      {},
    );
  }

  /** Every product of the category gets the category's default preparation time. */
  applyCategoryPrepTime(categoryId: string): Observable<{ products: number }> {
    return this.http.post<{ products: number }>(
      `${this.api.baseUrl}/admin/categories/${categoryId}/prep-time/apply`,
      {},
    );
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

  /** Every store of the brand — open to menu editors, unlike `listStores`. */
  listProductStores(brandId: string): Observable<ProductStoreOptionDto[]> {
    return this.http.get<ProductStoreOptionDto[]>(`${this.api.baseUrl}/admin/products/stores`, {
      params: { brandId },
    });
  }

  getStoreAvailability(storeId: string): Observable<StoreAvailabilityDto> {
    return this.http.get<StoreAvailabilityDto>(`${this.api.baseUrl}/admin/stores/${storeId}/availability`);
  }

  stopIngredientInStore(storeId: string, ingredientId: string, expiresAt?: string): Observable<AvailabilityStopDto> {
    return this.http.put<AvailabilityStopDto>(
      `${this.api.baseUrl}/admin/stores/${storeId}/ingredient-stops/${ingredientId}`,
      expiresAt ? { expiresAt } : {},
    );
  }

  resumeIngredientInStore(storeId: string, ingredientId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${storeId}/ingredient-stops/${ingredientId}`);
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

  listIngredients(brandId: string): Observable<IngredientDto[]> {
    return this.http.get<IngredientDto[]>(`${this.api.baseUrl}/admin/ingredients`, { params: { brandId } });
  }

  createIngredient(input: {
    brandId: string;
    name: string;
    priceCents?: number;
    group?: string | null;
  }): Observable<IngredientDto> {
    return this.http.post<IngredientDto>(`${this.api.baseUrl}/admin/ingredients`, input);
  }

  /** Add-on groups the brand uses, for suggestions. */
  listOptionGroups(brandId: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.api.baseUrl}/admin/ingredients/groups`, { params: { brandId } });
  }

  /** A new name, price or group also reaches every option that still carries the old one. */
  updateIngredient(
    id: string,
    input: { name?: string; priceCents?: number; isAvailable?: boolean; group?: string | null },
  ): Observable<IngredientDto> {
    return this.http.patch<IngredientDto>(`${this.api.baseUrl}/admin/ingredients/${id}`, input);
  }

  /** Takes the add-on off every product that offers it, then out of the library. */
  deleteIngredient(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/ingredients/${id}`);
  }
}
