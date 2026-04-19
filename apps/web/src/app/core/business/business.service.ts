import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession } from '@takeaway/shared-types';
import { Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { AuthStore } from '../auth/auth.store';

export interface BusinessRegisterRequest {
  brandName: string;
  ownerName: string;
  email: string;
  password: string;
  phone?: string;
  currency?: 'USD' | 'EUR' | 'GBP' | 'AED' | 'THB' | 'IDR';
  locale?: 'EN' | 'RU';
}

export interface BusinessBrand {
  id: string;
  slug: string;
  name: string;
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface BusinessRegisterResponse {
  brand: BusinessBrand;
  session: AuthSession;
}

@Injectable({ providedIn: 'root' })
export class BusinessService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly store = inject(AuthStore);

  register(body: BusinessRegisterRequest): Observable<BusinessRegisterResponse> {
    return this.http
      .post<BusinessRegisterResponse>(`${this.api.baseUrl}/business/register`, body)
      .pipe(tap((res) => this.store.set(res.session)));
  }
}
