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
  phone?: string | null;
  email?: string | null;
  status?: 'OPEN' | 'CLOSED' | 'OVERLOADED';
  minOrderCents?: number;
}

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

  listStores(brandId?: string): Observable<StoreAdminDto[]> {
    const params = brandId ? { brandId } : undefined;
    return this.http.get<StoreAdminDto[]>(`${this.api.baseUrl}/admin/stores`, { params });
  }

  getStore(id: string): Observable<StoreAdminDto> {
    return this.http.get<StoreAdminDto>(`${this.api.baseUrl}/admin/stores/${id}`);
  }

  updateStore(id: string, input: UpdateStoreInput): Observable<StoreAdminDto> {
    return this.http.patch<StoreAdminDto>(`${this.api.baseUrl}/admin/stores/${id}`, input);
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
