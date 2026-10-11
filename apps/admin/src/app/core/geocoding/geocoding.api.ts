import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

export interface GeocodeQuery {
  /** Street and house number. */
  address: string;
  city?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** Short readable name of what was found. */
  displayName: string;
  /** Only the city was found: open the map there, but do not put the pin on it. */
  approximate: boolean;
}

export interface AddressSuggestion {
  lat: number;
  lng: number;
  displayName: string;
  addressLine: string | null;
  city: string | null;
  country: string | null;
}

/**
 * The API's address lookup (OpenStreetMap behind it). The browser never asks
 * OSM directly — the API paces and caches the requests as OSM's policy wants.
 */
@Injectable({ providedIn: 'root' })
export class GeocodingApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** Null when nothing was found; 503 `GEOCODER_UNAVAILABLE` when the lookup itself failed. */
  locate(query: GeocodeQuery): Observable<GeocodeResult | null> {
    const params: Record<string, string> = { address: query.address };
    if (query.city) params['city'] = query.city;
    if (query.country) params['country'] = query.country;
    return this.http
      .get<{ result: GeocodeResult | null }>(`${this.api.baseUrl}/admin/geocode`, { params })
      .pipe(map((body) => body?.result ?? null));
  }

  /** What address is at a point; null when OSM has none there. */
  reverse(lat: number, lng: number): Observable<AddressSuggestion | null> {
    return this.http
      .get<{ result: AddressSuggestion | null }>(`${this.api.baseUrl}/admin/geocode/reverse`, {
        params: { lat: String(lat), lng: String(lng) },
      })
      .pipe(map((body) => body?.result ?? null));
  }
}
