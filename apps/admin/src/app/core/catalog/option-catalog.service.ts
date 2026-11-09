import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  BrandOptionCatalog,
  BrandOptionSetting,
  CatalogGroup,
  CatalogOption,
  LegacyOptionsSummary,
  ProductOptionGroupsConfig,
  UpsertCatalogGroupRequest,
  UpsertCatalogOptionRequest,
} from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** A catalog option's stop in one store; `expiresAt` null = until lifted by hand. */
export interface OptionStopDto {
  expiresAt: string | null;
}

/** What a brand changes on one catalog option: the add-on's price, whether it has it. */
export interface BrandOptionChange {
  priceCents?: number;
  enabled?: boolean;
}

/**
 * The options catalog («Добавки и варианты», `docs/option-groups.md`): the
 * platform's groups and options (SUPER_ADMIN), the catalog as one brand has
 * it, a store's stops, a product's attached groups and the brand's older
 * per-product options.
 */
@Injectable({ providedIn: 'root' })
export class OptionCatalogApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** Every group with its options and `productCount`. SUPER_ADMIN. */
  listGroups(): Observable<CatalogGroup[]> {
    return this.http.get<CatalogGroup[]>(`${this.api.baseUrl}/admin/option-groups`);
  }

  createGroup(input: UpsertCatalogGroupRequest): Observable<CatalogGroup> {
    return this.http.post<CatalogGroup>(`${this.api.baseUrl}/admin/option-groups`, input);
  }

  updateGroup(id: string, input: Partial<UpsertCatalogGroupRequest>): Observable<CatalogGroup> {
    return this.http.patch<CatalogGroup>(`${this.api.baseUrl}/admin/option-groups/${id}`, input);
  }

  /** 409 `OPTION_GROUP_IN_USE` while a product has it attached. */
  deleteGroup(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/option-groups/${id}`);
  }

  createOption(groupId: string, input: UpsertCatalogOptionRequest): Observable<CatalogOption> {
    return this.http.post<CatalogOption>(`${this.api.baseUrl}/admin/option-groups/${groupId}/options`, input);
  }

  updateOption(id: string, input: Partial<UpsertCatalogOptionRequest>): Observable<CatalogOption> {
    return this.http.patch<CatalogOption>(`${this.api.baseUrl}/admin/option-items/${id}`, input);
  }

  deleteOption(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/option-items/${id}`);
  }

  /** The whole catalog with the brand's prices, switches and store stops. */
  brandCatalog(brandId: string): Observable<BrandOptionCatalog> {
    return this.http.get<BrandOptionCatalog>(`${this.api.baseUrl}/admin/brands/${brandId}/options`);
  }

  /**
   * The answer's shape is not part of the contract, so callers apply the
   * change they sent rather than read it back.
   */
  updateBrandOption(brandId: string, optionId: string, change: BrandOptionChange): Observable<unknown> {
    return this.http.patch<BrandOptionSetting>(
      `${this.api.baseUrl}/admin/brands/${brandId}/options/${optionId}`,
      change,
    );
  }

  /** `expiresAt` null = until lifted by hand. */
  stopInStore(storeId: string, optionId: string, expiresAt: string | null): Observable<OptionStopDto | null> {
    return this.http.put<OptionStopDto | null>(`${this.api.baseUrl}/admin/stores/${storeId}/option-stops/${optionId}`, {
      expiresAt,
    });
  }

  resumeInStore(storeId: string, optionId: string): Observable<void> {
    return this.http.delete<void>(`${this.api.baseUrl}/admin/stores/${storeId}/option-stops/${optionId}`);
  }

  productGroups(productId: string): Observable<ProductOptionGroupsConfig> {
    return this.http.get<ProductOptionGroupsConfig>(`${this.api.baseUrl}/admin/products/${productId}/option-groups`);
  }

  /** Replaces the attached groups and the product's own values. */
  saveProductGroups(productId: string, config: ProductOptionGroupsConfig): Observable<ProductOptionGroupsConfig> {
    return this.http.put<ProductOptionGroupsConfig>(
      `${this.api.baseUrl}/admin/products/${productId}/option-groups`,
      config,
    );
  }

  /** SUPER_ADMIN: what the brand still has of the older per-product options. */
  legacySummary(brandId: string): Observable<LegacyOptionsSummary> {
    return this.http.get<LegacyOptionsSummary>(`${this.api.baseUrl}/admin/brands/${brandId}/legacy-options`);
  }

  /** SUPER_ADMIN: deletes them; answers what was deleted. */
  clearLegacy(brandId: string): Observable<LegacyOptionsSummary> {
    return this.http.post<LegacyOptionsSummary>(`${this.api.baseUrl}/admin/brands/${brandId}/legacy-options/clear`, {});
  }
}
