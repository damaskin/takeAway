import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { BrandPlan } from '@takeaway/shared-types';

import { ActiveBrandService } from '../brand-context/active-brand.service';
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
  /** True once the brand has an order: the API then refuses a new currency. */
  currencyLocked?: boolean;
  /** Business plan and platform commission (basis points); read-only here. */
  plan?: BrandPlan;
  commissionBps?: number;
  /** The number the takeAway team calls the business on, E.164. */
  contactPhone?: string | null;
  /** The plan asked for with «Перейти на PRO», while the request stands. */
  requestedPlan?: BrandPlan | null;
  planRequestedAt?: string | null;
  _count?: { stores: number; products: number };
}

export interface UpdateMyBrandRequest {
  name?: string;
  logoUrl?: string;
  currency?: string;
  locale?: 'EN' | 'RU';
  themeOverrides?: Record<string, string>;
  /** Any common format; the API stores E.164. */
  contactPhone?: string;
}

/** The standing «Перейти на PRO» request. */
export interface PlanRequest {
  requestedPlan: BrandPlan;
  planRequestedAt: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly activeBrand = inject(ActiveBrandService);

  getMyBrand(): Observable<MyBrand> {
    return this.http.get<MyBrand>(`${this.api.baseUrl}/my-brand`, { params: this.brandParams() });
  }

  updateMyBrand(body: UpdateMyBrandRequest): Observable<MyBrand> {
    return this.http.patch<MyBrand>(`${this.api.baseUrl}/my-brand`, body, { params: this.brandParams() });
  }

  /** «Перейти на PRO»: asks the takeAway team; they get in touch. Asking twice is harmless. */
  requestPlan(plan: BrandPlan, note?: string): Observable<PlanRequest> {
    return this.http.post<PlanRequest>(
      `${this.api.baseUrl}/my-brand/plan-request`,
      { plan, ...(note ? { note } : {}) },
      { params: this.brandParams() },
    );
  }

  uploadLogo(file: File): Observable<{ logoUrl: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ logoUrl: string }>(`${this.api.baseUrl}/my-brand/logo`, fd, {
      params: this.brandParams(),
    });
  }

  /**
   * The brand picked in the top bar. A SUPER_ADMIN owns no brand and has to
   * name one; an owner of several brands edits the one in view, and the API
   * checks that it is theirs.
   */
  private brandParams(): HttpParams {
    const id = this.activeBrand.activeId();
    return id ? new HttpParams().set('brandId', id) : new HttpParams();
  }
}
