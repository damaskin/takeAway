import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type { CardPaymentFlow } from '@takeaway/shared-types';

import { API_CONFIG } from '../api/api.config';

export interface FeatureFlags {
  deliveryEnabled: boolean;
  /** "Bound cards work here" — kept for clients that predate `cardPaymentFlow`. */
  agroprombankEnabled: boolean;
  /** Absent on servers that predate it; see {@link resolveCardPaymentFlow}. */
  cardPaymentFlow?: CardPaymentFlow;
}

const DEFAULTS: FeatureFlags = { deliveryEnabled: false, agroprombankEnabled: false };

const FLOWS: readonly CardPaymentFlow[] = ['token', 'web', 'none'];

/**
 * The card checkout to run. A server that predates `cardPaymentFlow` only
 * knows bound cards, so its `agroprombankEnabled` decides between those and
 * nothing at all.
 */
export function resolveCardPaymentFlow(flags: FeatureFlags): CardPaymentFlow {
  const flow = flags.cardPaymentFlow;
  if (flow && FLOWS.includes(flow)) return flow;
  return flags.agroprombankEnabled ? 'token' : 'none';
}

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
  /** How a card order gets paid: a bound card, the bank's page, or not at all. */
  readonly cardPaymentFlow = computed(() => resolveCardPaymentFlow(this._flags()));
  /** Orders can be paid by card at all, whichever way. */
  readonly cardPaymentsEnabled = computed(() => this.cardPaymentFlow() !== 'none');
  /** Cards bound in the profile and held in one tap. */
  readonly boundCardsEnabled = computed(() => this.cardPaymentFlow() === 'token');
  /** Checkout sends the customer to the bank's own payment page. */
  readonly webPaymentsEnabled = computed(() => this.cardPaymentFlow() === 'web');

  load(): void {
    this.http.get<FeatureFlags>(`${this.api.baseUrl}/config/features`).subscribe({
      next: (f) => this._flags.set({ ...DEFAULTS, ...f }),
      error: () => undefined,
    });
  }
}
