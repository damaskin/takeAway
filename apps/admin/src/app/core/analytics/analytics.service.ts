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

export interface DashboardSummary {
  revenueTodayCents: number;
  ordersToday: number;
  avgPickupSeconds: number;
  nps: number;
  deltas: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  summary(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>(`${this.api.baseUrl}/admin/analytics/summary`);
  }

  revenue(days = 14): Observable<RevenueSeries> {
    return this.http.get<RevenueSeries>(`${this.api.baseUrl}/admin/analytics/revenue?days=${days}`);
  }

  topProducts(take = 5): Observable<TopProduct[]> {
    return this.http.get<TopProduct[]>(`${this.api.baseUrl}/admin/analytics/top-products?take=${take}`);
  }

  cohort(days = 30): Observable<CohortStats> {
    return this.http.get<CohortStats>(`${this.api.baseUrl}/admin/analytics/cohort?days=${days}`);
  }

  storePerformance(days = 14): Observable<StorePerformance[]> {
    return this.http.get<StorePerformance[]>(`${this.api.baseUrl}/admin/analytics/stores?days=${days}`);
  }
}
