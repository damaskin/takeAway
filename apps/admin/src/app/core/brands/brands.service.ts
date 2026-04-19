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
}
