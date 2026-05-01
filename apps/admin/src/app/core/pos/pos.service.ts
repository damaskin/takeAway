import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export type PosProvider = 'IIKO' | 'POSTER';
export type PosIntegrationStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
export type PosSyncJobKind = 'STORES' | 'MENU' | 'STOP_LIST' | 'ORDER_PUSH';
export type PosSyncJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface PosSyncJobView {
  id: string;
  kind: PosSyncJobKind;
  status: PosSyncJobStatus;
  progress: number;
  total: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PosIntegrationView {
  id: string;
  brandId: string;
  provider: PosProvider;
  status: PosIntegrationStatus;
  settings: Record<string, unknown>;
  lastSyncAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  lastJob: PosSyncJobView | null;
}

export interface ConnectPosRequest {
  provider: PosProvider;
  credentials: Record<string, string>;
  settings?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class PosApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  status(brandId?: string): Observable<PosIntegrationView[]> {
    const url = `${this.api.baseUrl}/admin/pos/status${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`;
    return this.http.get<PosIntegrationView[]>(url);
  }

  connect(body: ConnectPosRequest, brandId?: string): Observable<PosIntegrationView> {
    const url = `${this.api.baseUrl}/admin/pos/connect${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`;
    return this.http.post<PosIntegrationView>(url, body);
  }

  disconnect(provider: PosProvider, brandId?: string): Observable<void> {
    const url = `${this.api.baseUrl}/admin/pos/disconnect/${provider}${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`;
    return this.http.delete<void>(url);
  }

  syncStores(provider: PosProvider, brandId?: string): Observable<PosSyncJobView> {
    return this.enqueue('stores', provider, brandId);
  }

  syncMenu(provider: PosProvider, brandId?: string): Observable<PosSyncJobView> {
    return this.enqueue('menu', provider, brandId);
  }

  syncStopList(provider: PosProvider, brandId?: string): Observable<PosSyncJobView> {
    return this.enqueue('stop-list', provider, brandId);
  }

  jobs(provider: PosProvider, brandId?: string): Observable<PosSyncJobView[]> {
    const url = `${this.api.baseUrl}/admin/pos/jobs/${provider}${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`;
    return this.http.get<PosSyncJobView[]>(url);
  }

  private enqueue(
    kind: 'stores' | 'menu' | 'stop-list',
    provider: PosProvider,
    brandId?: string,
  ): Observable<PosSyncJobView> {
    const url = `${this.api.baseUrl}/admin/pos/sync/${kind}/${provider}${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`;
    return this.http.post<PosSyncJobView>(url, {});
  }
}
