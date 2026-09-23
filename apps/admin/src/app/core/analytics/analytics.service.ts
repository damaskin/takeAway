import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface RevenuePoint {
  date: string;
  revenueCents: number;
  orderCount: number;
}

export interface RevenueSeries {
  totalRevenueCents: number;
  totalOrders: number;
  avgBasketCents: number;
  bestDay: RevenuePoint | null;
  revenueDeltaPercent: number;
  points: RevenuePoint[];
}

export interface TopProduct {
  name: string;
  unitsSold: number;
  revenueCents: number;
}

export interface CohortStats {
  repeatRatePercent: number;
  avgBasketCents: number;
  newCustomers: number;
  pickupSlaPercent: number;
}

export interface StorePerformance {
  storeId: string;
  storeName: string;
  revenueCents: number;
  orders: number;
  sharePercent: number;
}

/** The last `days` calendar days, each figure against the `days` before them. */
export interface DashboardSummary {
  days: number;
  revenueCents: number;
  orders: number;
  avgPickupSeconds: number;
  /** Null until customer ratings are collected. */
  nps: number | null;
  /** Percent change; null when the period before had nothing to compare with. */
  revenueDeltaPercent: number | null;
  ordersDeltaPercent: number | null;
  /** Change of the average pickup time, in seconds. */
  pickupDeltaSeconds: number | null;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  // `brandId` picks one of the caller's brands; the API never widens past them.

  summary(brandId?: string | null, days = 7): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>(`${this.api.baseUrl}/admin/analytics/summary`, {
      params: params({ brandId, days }),
    });
  }

  revenue(days = 14, brandId?: string | null): Observable<RevenueSeries> {
    return this.http.get<RevenueSeries>(`${this.api.baseUrl}/admin/analytics/revenue`, {
      params: params({ days, brandId }),
    });
  }

  topProducts(take = 5, brandId?: string | null): Observable<TopProduct[]> {
    return this.http.get<TopProduct[]>(`${this.api.baseUrl}/admin/analytics/top-products`, {
      params: params({ take, brandId }),
    });
  }

  cohort(days = 30, brandId?: string | null): Observable<CohortStats> {
    return this.http.get<CohortStats>(`${this.api.baseUrl}/admin/analytics/cohort`, {
      params: params({ days, brandId }),
    });
  }

  storePerformance(days = 14, brandId?: string | null): Observable<StorePerformance[]> {
    return this.http.get<StorePerformance[]>(`${this.api.baseUrl}/admin/analytics/stores`, {
      params: params({ days, brandId }),
    });
  }
}

function params(values: Record<string, string | number | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') out[key] = String(value);
  }
  return out;
}
