import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface StoreSummary {
  id: string;
  slug: string;
  name: string;
  city: string;
}

@Injectable({ providedIn: 'root' })
export class StoresApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(): Observable<StoreSummary[]> {
    return this.http.get<StoreSummary[]>(`${this.api.baseUrl}/stores`);
  }
}
