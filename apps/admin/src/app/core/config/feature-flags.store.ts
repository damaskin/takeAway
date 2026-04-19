import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { API_CONFIG } from '../api/api.config';

export interface FeatureFlags {
  deliveryEnabled: boolean;
}

/**
 * Fetches and caches /config/features for the admin app. Nav visibility +
 * route guards read `flags()` synchronously; until the first response
 * arrives the defaults (all false) apply, which is the safe thing to show.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _flags = signal<FeatureFlags>({ deliveryEnabled: false });
  readonly flags = this._flags.asReadonly();
  readonly deliveryEnabled = computed(() => this._flags().deliveryEnabled);

  load(): void {
    this.http.get<FeatureFlags>(`${this.api.baseUrl}/config/features`).subscribe({
      next: (f) => this._flags.set(f),
      // Failure leaves defaults (all off) — fail-safe: an ops outage on the
      // features endpoint shouldn't accidentally expose a hidden module.
      error: () => undefined,
    });
  }
}
