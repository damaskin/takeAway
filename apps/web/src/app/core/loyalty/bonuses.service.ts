import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CustomerBonus } from '@takeaway/shared-types';
import { type Observable, map } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/** sessionStorage key: the carts the customer took their bonus off in this tab. */
const DISMISSED_KEY = 'takeaway.bonus.dismissed';

/**
 * The customer's bonuses — today the welcome bonus of «Акции takeAway»
 * (docs/takeaway-promos.md §4.3) — and the carts they took it off.
 *
 * Checkout puts the bonus on by itself; once the customer removes it from a
 * cart it stays off for that cart until the tab closes, so a reload or a
 * trip back from the bank's page does not put it back against their will.
 */
@Injectable({ providedIn: 'root' })
export class BonusesService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  /** Kept here too: sessionStorage may be unavailable (private mode, a blocked store). */
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
      // In memory only, then: the bonus stays off until a reload.
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
