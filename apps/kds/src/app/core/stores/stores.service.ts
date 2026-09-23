import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface StoreSummary {
  id: string;
  slug: string;
  name: string;
  city: string;
  /** IANA zone: the board's clock and pickup times follow the store, not the tablet. */
  timezone?: string;
}

/** The store this tablet was set up for on the PIN screen. */
const STORE_KEY = 'takeaway.kds.storeId';

export function rememberedStoreId(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

export function rememberStoreId(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    // Storage-disabled browsers: the board still works, it just forgets.
  }
}

@Injectable({ providedIn: 'root' })
export class StoresApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** Every public store — what a tablet can be set up for before anyone signs in. */
  list(): Observable<StoreSummary[]> {
    return this.http.get<StoreSummary[]>(`${this.api.baseUrl}/stores`);
  }

  /** The stores the signed-in person may run: their brand's, or the ones they are assigned to. */
  listMine(): Observable<StoreSummary[]> {
    return this.http.get<StoreSummary[]>(`${this.api.baseUrl}/admin/stores`);
  }
}
