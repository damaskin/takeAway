import { type Signal, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { StoreSuggestions } from '@takeaway/shared-types';
import { catchError, defer, of, switchMap } from 'rxjs';

import { CatalogService } from './catalog.service';

/** The store and the products in hand to ask suggestions for; null while there is nothing to ask. */
export interface SuggestionsQuery {
  storeId: string;
  productIds: readonly string[];
}

/**
 * The store's answer to «what goes with these?» (`GET /stores/:id/suggestions`),
 * asked again whenever the store or the set of products changes — a new
 * quantity does not count. `undefined` until the first answer lands, `null`
 * when the call failed (an API from before the endpoint, or no network):
 * `suggestionRow` then falls back to the menu rule. A newer question drops
 * one still in flight, and the last answer stays until the next lands, so
 * the row does not blink while the cart changes.
 *
 * Call from an injection context (a field initializer).
 */
export function storeSuggestions(
  query: () => SuggestionsQuery | null,
  limit = 6,
): Signal<StoreSuggestions | null | undefined> {
  const catalog = inject(CatalogService);
  const asked = computed(
    () => {
      const q = query();
      const productIds = [...new Set(q?.productIds ?? [])].sort();
      return q && productIds.length > 0 ? { storeId: q.storeId, productIds } : null;
    },
    { equal: (a, b) => a?.storeId === b?.storeId && a?.productIds.join() === b?.productIds.join() },
  );
  return toSignal(
    toObservable(asked).pipe(
      switchMap((q) =>
        q
          ? defer(() => catalog.getSuggestions(q.storeId, q.productIds, limit)).pipe(catchError(() => of(null)))
          : of(undefined),
      ),
    ),
    { initialValue: undefined },
  );
}
