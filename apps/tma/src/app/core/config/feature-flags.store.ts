import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { API_CONFIG } from '../api/api.config';

export interface FeatureFlags {
  deliveryEnabled: boolean;
  agroprombankEnabled: boolean;
}

const DEFAULTS: FeatureFlags = { deliveryEnabled: false, agroprombankEnabled: false };

/**
 * Fetches and caches `/config/features`. Everything reads `flags()`
 * synchronously; until the first response lands the defaults (all off) apply,
 * which is the safe thing to show — an outage on the features endpoint must
 * not surface a module ops hasn't switched on.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsStore {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private readonly _flags = signal<FeatureFlags>(DEFAULTS);
  readonly flags = this._flags.asReadonly();
  readonly deliveryEnabled = computed(() => this._flags().deliveryEnabled);
  readonly cardPaymentsEnabled = computed(() => this._flags().agroprombankEnabled);

  load(): void {
    this.http.get<FeatureFlags>(`${this.api.baseUrl}/config/features`).subscribe({
      next: (f) => this._flags.set({ ...DEFAULTS, ...f }),
      error: () => undefined,
    });
  }
}
