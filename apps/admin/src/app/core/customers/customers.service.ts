import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type CustomerSort = 'lastOrderAt' | 'firstOrderAt' | 'orders' | 'totalCents' | 'avgCheckCents' | 'frequency';

export interface CustomerSummary {
  userId: string;
  name: string | null;
  phone: string | null;
  orders: number;
  totalCents: number;
  avgCheckCents: number;
  firstOrderAt: string;
  lastOrderAt: string;
  /** Null with a single order. */
  avgDaysBetweenOrders: number | null;
  daysSinceLastOrder: number;
  favouriteStoreId: string | null;
  favouriteStoreName: string | null;
}

export interface CustomerPage {
  items: CustomerSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CustomerOrder {
  id: string;
  orderCode: string;
  createdAt: string;
  status: string;
  totalCents: number;
  currency: string;
  storeName: string;
  itemCount: number;
}

export interface CustomerDetail extends CustomerSummary {
  email: string | null;
  cancelledOrders: number;
  stores: Array<{ storeId: string; storeName: string; orders: number; totalCents: number }>;
  recentOrders: CustomerOrder[];
}

export interface CustomersQuery {
  brandId?: string | null;
  storeId?: string | null;
  search?: string;
  sort?: CustomerSort;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** `/admin/customers` — the brand's customers (PRO). */
@Injectable({ providedIn: 'root' })
export class CustomersApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(query: CustomersQuery): Observable<CustomerPage> {
    return this.http.get<CustomerPage>(`${this.api.baseUrl}/admin/customers`, { params: compact(query) });
  }

  get(userId: string, brandId?: string | null): Observable<CustomerDetail> {
    return this.http.get<CustomerDetail>(`${this.api.baseUrl}/admin/customers/${encodeURIComponent(userId)}`, {
      params: compact({ brandId }),
    });
  }
}

function compact(values: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') out[key] = String(value);
  }
  return out;
}
