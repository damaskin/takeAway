import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface MyBrand {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  currency: string;
  locale: 'EN' | 'RU';
  themeOverrides: Record<string, string> | null;
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  moderationNote: string | null;
  _count?: { stores: number; products: number };
}

export interface UpdateMyBrandRequest {
  name?: string;
  logoUrl?: string;
  themeOverrides?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  getMyBrand(): Observable<MyBrand> {
    return this.http.get<MyBrand>(`${this.api.baseUrl}/my-brand`);
  }

  updateMyBrand(body: UpdateMyBrandRequest): Observable<MyBrand> {
    return this.http.patch<MyBrand>(`${this.api.baseUrl}/my-brand`, body);
  }

  uploadLogo(file: File): Observable<{ logoUrl: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ logoUrl: string }>(`${this.api.baseUrl}/my-brand/logo`, fd);
  }
}
