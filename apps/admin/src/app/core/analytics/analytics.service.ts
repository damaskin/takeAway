import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { BusinessOverview, PlatformOverview } from '@takeaway/shared-types';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * The days a request covers: `days` ending today, or `from`/`to` calendar
 * days (both included). The API reads them in the brand's time zone and
 * compares with as many days right before. `storeId` narrows to one store.
 */
export interface AnalyticsPeriod {
  days?: number;
  from?: string;
  to?: string;
  storeId?: string | null;
}

/** The days a figure covers, as the API read them. */
export interface AnalyticsPeriodEcho {
  from: string;
  to: string;
  timeZone: string;
}

export interface RevenuePoint {
  date: string;
  revenueCents: number;
  orderCount: number;
}

export interface RevenueSeries extends AnalyticsPeriodEcho {
  totalRevenueCents: number;
  totalOrders: number;
  avgBasketCents: number;
  bestDay: RevenuePoint | null;
  revenueDeltaPercent: number;
  previousRevenueCents: number;
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

/** One store; the fields after `detailed` are the PRO comparison, null on BASIC. */
export interface StorePerformance {
  storeId: string;
  storeName: string;
  revenueCents: number;
  orders: number;
  sharePercent: number;
  detailed: boolean;
  ordersSharePercent: number | null;
  avgCheckCents: number | null;
  avgPickupSeconds: number | null;
  avgPrepSeconds: number | null;
  cancelled: number | null;
  expired: number | null;
  cancelRatePercent: number | null;
  customers: number | null;
  staff: number | null;
  ordersPerStaff: number | null;
  previousRevenueCents: number | null;
  revenueDeltaPercent: number | null;
}

export interface StaffPerformance {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  accepted: number;
  ready: number;
  completed: number;
  handled: number;
  shifts: number;
  shiftHours: number;
  ordersPerHour: number | null;
}

export type ChurnWindow = 7 | 14;

export interface RetentionCustomer {
  userId: string;
  name: string | null;
  phone: string | null;
  orders: number;
  totalCents: number;
  avgCheckCents: number;
  lastOrderAt: string;
  daysSinceLastOrder: number;
}

export interface ChurnStats extends AnalyticsPeriodEcho {
  window: ChurnWindow;
  count: number;
  lostRevenueCents: number;
  previous: { count: number; lostRevenueCents: number };
  countDeltaPercent: number | null;
  /** Null on a plan without the list. */
  customers: RetentionCustomer[] | null;
}

export interface WinBackPeriod {
  lapsedAtStart: number;
  returned: number;
  returnRatePercent: number | null;
  orders: number;
  revenueCents: number;
}

export interface WinBackCustomer {
  userId: string;
  name: string | null;
  phone: string | null;
  lastOrderBefore: string;
  returnedAt: string;
  daysAway: number;
  orders: number;
  revenueCents: number;
}

export interface WinBackStats extends AnalyticsPeriodEcho {
  window: ChurnWindow;
  current: WinBackPeriod;
  previous: WinBackPeriod;
  returnedDeltaPercent: number | null;
  revenueDeltaPercent: number | null;
  customers: WinBackCustomer[];
}

/** Where the orders stand: open ones right now, and how the period ended up. */
export interface OrderStatusStats extends AnalyticsPeriodEcho {
  days: number;
  /** Open statuses only, each present, regardless of the period. */
  live: Record<'CREATED' | 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY' | 'OUT_FOR_DELIVERY', number>;
  liveTotal: number;
  period: {
    total: number;
    completed: number;
    cancelled: number;
    expired: number;
    /** Null until an order of the period has finished one way or another. */
    completionRatePercent: number | null;
    byStatus: Record<string, number>;
  };
}

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  // `brandId` picks one of the caller's brands; the API never widens past them.

  /** The dashboard in one request: KPIs, days, stores, statuses, load (PRO). */
  overview(brandId: string | null | undefined, period: AnalyticsPeriod): Observable<BusinessOverview> {
    return this.get('overview', brandId, period);
  }

  /** SUPER_ADMIN only: the platform's dashboard, brands side by side, in one currency. */
  platformOverview(period: AnalyticsPeriod, currency?: string | null): Observable<PlatformOverview> {
    return this.http.get<PlatformOverview>(`${this.api.baseUrl}/admin/platform/overview`, {
      params: params({
        ...(period.from || period.to ? { from: period.from, to: period.to } : { days: period.days }),
        currency,
      }),
    });
  }

  revenue(brandId: string | null | undefined, period: AnalyticsPeriod): Observable<RevenueSeries> {
    return this.get('revenue', brandId, period);
  }

  topProducts(brandId: string | null | undefined, period: AnalyticsPeriod, take = 5): Observable<TopProduct[]> {
    return this.get('top-products', brandId, period, { take });
  }

  cohort(brandId: string | null | undefined, period: AnalyticsPeriod): Observable<CohortStats> {
    return this.get('cohort', brandId, period);
  }

  orderStatuses(brandId: string | null | undefined, period: AnalyticsPeriod): Observable<OrderStatusStats> {
    return this.get('order-statuses', brandId, period);
  }

  storePerformance(brandId: string | null | undefined, period: AnalyticsPeriod): Observable<StorePerformance[]> {
    return this.get('stores', brandId, period);
  }

  staff(brandId: string | null | undefined, period: AnalyticsPeriod): Observable<StaffPerformance[]> {
    return this.get('staff', brandId, period);
  }

  churn(
    brandId: string | null | undefined,
    period: AnalyticsPeriod,
    window: ChurnWindow,
    take?: number,
  ): Observable<ChurnStats> {
    return this.get('churn', brandId, period, { window, take });
  }

  winBack(
    brandId: string | null | undefined,
    period: AnalyticsPeriod,
    window: ChurnWindow,
    take?: number,
  ): Observable<WinBackStats> {
    return this.get('winback', brandId, period, { window, take });
  }

  private get<T>(
    path: string,
    brandId: string | null | undefined,
    period: AnalyticsPeriod,
    extra: Record<string, string | number | null | undefined> = {},
  ): Observable<T> {
    return this.http.get<T>(`${this.api.baseUrl}/admin/analytics/${path}`, {
      params: params({
        brandId,
        storeId: period.storeId,
        // A custom range wins over a preset; never send both.
        ...(period.from || period.to ? { from: period.from, to: period.to } : { days: period.days }),
        ...extra,
      }),
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
