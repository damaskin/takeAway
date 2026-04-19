import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface DeliveryQuoteDto {
  feeCents: number;
  distanceM: number | null;
  deliverable: boolean;
  reason: 'OK' | 'NO_COORDS_FLAT' | 'OUTSIDE_RADIUS' | 'STORE_NOT_DELIVERING';
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class DeliveryFeeApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  quote(input: { storeId: string; latitude?: number; longitude?: number }): Observable<DeliveryQuoteDto> {
    return this.http.post<DeliveryQuoteDto>(`${this.api.baseUrl}/delivery/quote`, input);
  }
}
