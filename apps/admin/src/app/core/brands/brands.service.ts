import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
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
  /** Required by the API when rejecting: it is the reason the owner is emailed. */
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

  private readonly _pendingCount = signal<number | null>(null);
  /** Brands waiting for review — the badge on «Бренды». Null until known. */
  readonly pendingCount = this._pendingCount.asReadonly();

  list(status?: BrandModerationStatus): Observable<AdminBrand[]> {
    const url = status ? `${this.api.baseUrl}/admin/brands?status=${status}` : `${this.api.baseUrl}/admin/brands`;
    return this.http.get<AdminBrand[]>(url);
  }

  /** SUPER_ADMIN only. A failure keeps the last known count. */
  loadPendingCount(): void {
    this.http.get<{ count: number }>(`${this.api.baseUrl}/admin/brands/pending-count`).subscribe({
      next: (res) => {
        if (typeof res?.count === 'number') this._pendingCount.set(res.count);
      },
      error: () => undefined,
    });
  }

  /** For the brands page, which holds the whole list and knows the number already. */
  setPendingCount(count: number): void {
    this._pendingCount.set(count);
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
