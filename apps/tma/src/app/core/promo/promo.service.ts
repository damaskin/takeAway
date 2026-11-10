import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CustomerBonus, ValidPromoResult, ValidatePromoInput } from '@takeaway/shared-types';
import { type Observable, map } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** sessionStorage key: the carts the customer took their bonus off in this Mini App session. */
const DISMISSED_KEY = 'takeaway.tma.bonus.dismissed';

/** Promo codes at checkout: the brand's own, takeAway's promos and the welcome bonus — one field for all. */
@Injectable({ providedIn: 'root' })
export class PromoApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /**
   * `storeId` is the cart's store: a takeAway promo works only where the
   * store sells in the promo's currency (PROMO_NOT_HERE elsewhere).
   */
  validate(input: ValidatePromoInput): Observable<ValidPromoResult> {
    return this.http.post<ValidPromoResult>(`${this.api.baseUrl}/promo/validate`, input);
  }
}

/**
 * The customer's bonuses — today the welcome bonus of «Акции takeAway»
 * (docs/takeaway-promos.md §4.3) — and the carts they took it off.
 *
 * Checkout puts the bonus on by itself; once the customer removes it from a
 * cart it stays off for that cart until the Mini App is closed.
 */
@Injectable({ providedIn: 'root' })
export class BonusesApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  /** Kept here too: sessionStorage may be unavailable in a webview. */
  private readonly dismissed = new Set<string>(readDismissed());

  /** `GET /me/bonuses`: the unused bonus, while its promo still runs; `[]` otherwise. */
  list(): Observable<CustomerBonus[]> {
    return this.http
      .get<CustomerBonus[]>(`${this.api.baseUrl}/me/bonuses`)
      .pipe(map((bonuses) => (Array.isArray(bonuses) ? bonuses : [])));
  }

  /** The customer removed the bonus from this cart. */
  dismiss(cartId: string): void {
    this.dismissed.add(cartId);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...this.dismissed]));
    } catch {
      // In memory only, then: the bonus stays off until the Mini App reloads.
    }
  }

  isDismissed(cartId: string): boolean {
    return this.dismissed.has(cartId);
  }
}

function readDismissed(): string[] {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
