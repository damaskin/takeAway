import type { ProductSummary, StoreListItem, StoreMenu } from '@takeaway/shared-types';
import { sortStoresByAvailability, storeAvailability } from '@takeaway/utils';

/** A dish or drink for the home page's «Из меню», with the place that makes it. */
export interface MenuPick {
  product: ProductSummary;
  store: StoreListItem;
}

/**
 * The places whose menus the home page samples: one store per business —
 * stores of one brand share a menu — taking orders now, open before
 * "for later only", at most [limit].
 */
export function storesToSample(stores: readonly StoreListItem[], limit = 4): StoreListItem[] {
  const brands = new Set<string>();
  const picked: StoreListItem[] = [];
  for (const store of sortStoresByAvailability(stores)) {
    if (picked.length >= limit) break;
    if (storeAvailability(store) === 'closed' || brands.has(store.brandId)) continue;
    brands.add(store.brandId);
    picked.push(store);
  }
  return picked;
}

/**
 * A mix from several places, so the home page reads as a marketplace and
 * not as one café's menu: places take turns, and within a place the menu's
 * own order is kept, one item per category before a second one from any.
 * Only items with a photo that are not on the stop list: a grey tile sells
 * nothing.
 *
 * There is no sales ranking on the public API, so the business's own order
 * of its menu — what it puts first — stands in for "popular".
 */
export function mixMenuPicks(entries: readonly { store: StoreListItem; menu: StoreMenu }[], limit = 8): MenuPick[] {
  const perPlace = entries.map(({ store, menu }) => {
    const byCategory = menu.categories.map((c) => c.products.filter(showable));
    return interleave(byCategory).map((product) => ({ product, store }));
  });
  return interleave(perPlace).slice(0, limit);
}

function showable(product: ProductSummary): boolean {
  return !product.onStopList && product.imageUrls.length > 0;
}

/** [[a1, a2], [b1], [c1, c2, c3]] → [a1, b1, c1, a2, c2, c3]. */
function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}
