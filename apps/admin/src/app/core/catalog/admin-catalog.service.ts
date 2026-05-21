import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface BrandDto {
  id: string;
  slug: string;
  name: string;
  currency: string;
  locale: string;
  logoUrl: string | null;
}

export interface StoreWorkingHourDto {
  weekday: number;
  opensAt: number;
  closesAt: number;
  isClosed: boolean;
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
  status: 'OPEN' | 'CLOSED' | 'OVERLOADED';
  currency: string;
  phone?: string | null;
  email?: string | null;
  minOrderCents?: number;
  timezone?: string;
  workingHours?: StoreWorkingHourDto[];
}

export interface UpdateStoreInput {
  name?: string;
  addressLine?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  phone?: string | null;
  email?: string | null;
  status?: 'OPEN' | 'CLOSED' | 'OVERLOADED';
  minOrderCents?: number;
}

export interface CreateStoreInput {
  brandId: string;
  slug: string;
  name: string;
  addressLine: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  currency: string;
  timezone?: string;
  phone?: string;
  email?: string;
}

export interface VariationAdminDto {
  id: string;
  type: 'SIZE' | 'TEMPERATURE' | 'MILK' | 'CUP';
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
  slug: string;
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
}

export interface CreateCategoryInput {
  brandId: string;
  slug: string;
  name: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
  sortOrder?: number;
  visible?: boolean;
}

export interface CreateProductInput {
  brandId: string;
  categoryId: string;
  slug: string;
  name: string;
  description?: string;
  basePriceCents: number;
  prepTimeSeconds?: number;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  basePriceCents?: number;
  prepTimeSeconds?: number;
  sortOrder?: number;
  categoryId?: string;
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

  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/categories/${id}`);
  }

  reorderCategories(orderedIds: string[]): Observable<void> {
    return this.http.patch<void>(`${this.api.baseUrl}/admin/categories/reorder`, { orderedIds });
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
