import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type BrandModerationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AdminBrand {
  id: string;
  slug: string;
  name: string;
  moderationStatus: BrandModerationStatus;
  moderationNote: string | null;
  submittedAt: string;
  moderatedAt: string | null;
  createdAt: string;
  owner: { id: string; email: string | null; name: string | null; phone: string | null } | null;
  _count: { stores: number; products: number };
}

export interface SetBrandModerationRequest {
  status: BrandModerationStatus;
  note?: string;
}

export interface CreateBrandRequest {
  slug: string;
  name: string;
  currency?: string;
  locale?: 'EN' | 'RU';
}

@Injectable({ providedIn: 'root' })
export class BrandsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(status?: BrandModerationStatus): Observable<AdminBrand[]> {
    const url = status ? `${this.api.baseUrl}/admin/brands?status=${status}` : `${this.api.baseUrl}/admin/brands`;
    return this.http.get<AdminBrand[]>(url);
  }

  setModeration(id: string, body: SetBrandModerationRequest): Observable<AdminBrand> {
    return this.http.patch<AdminBrand>(`${this.api.baseUrl}/admin/brands/${id}/moderation`, body);
  }

  /**
   * Creates a brand directly, without going through self-serve sign-up.
   * This is how a fresh install gets its first brand — without one, stores
   * and menu have no context to be created in.
   */
  create(body: CreateBrandRequest): Observable<AdminBrand & { currency: string; locale: 'EN' | 'RU' }> {
    return this.http.post<AdminBrand & { currency: string; locale: 'EN' | 'RU' }>(
      `${this.api.baseUrl}/admin/brands`,
      body,
    );
  }
}
