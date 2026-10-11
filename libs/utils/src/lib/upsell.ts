import type { CategoryKind, ProductSummary, StoreMenu } from '@takeaway/shared-types';

import { isDrinkKind, isFoodKind, menuProductKinds, productKind } from './product-kind';

/** A product offered next to a drink, with its kind for the placeholder. */
export interface FoodSuggestion {
  product: ProductSummary;
  kind: CategoryKind;
}

/**
 * Something to eat with the drinks — «К заказу» in the cart, «Часто берут
 * вместе» on a drink's page.
 *
 * Offered only while the products in hand (the cart's lines, or the drink on
 * screen) include a drink and nothing to eat yet. The offer is the menu's
 * bakery and food: in stock, not already in hand, at most [limit], the
 * categories taking turns so a long pastry list does not crowd out the
 * sandwiches. The store's menu carries only what it sells — hidden and
 * add-ons-only categories never reach it — so nothing else is filtered.
 * Kinds come from the menu: a product in hand that is not on it counts as
 * neither.
 */
export function suggestFood(
  menu: Pick<StoreMenu, 'categories'> | null | undefined,
  productIds: readonly string[],
  limit = 6,
): FoodSuggestion[] {
  if (!menu || limit <= 0) return [];
  const kinds = menuProductKinds(menu);
  const inHand = productIds.map((id) => kinds.get(id)).filter((kind): kind is CategoryKind => kind !== undefined);
  if (!inHand.some(isDrinkKind) || inHand.some(isFoodKind)) return [];

  const taken = new Set(productIds);
  const byCategory = menu.categories.map((category) =>
    category.products
      .filter((product) => !product.onStopList && !taken.has(product.id))
      .map((product) => ({ product, kind: productKind(product, category) }))
      .filter((suggestion) => isFoodKind(suggestion.kind)),
  );
  return interleave(byCategory).slice(0, limit);
}

/** [[a1, a2], [b1], [c1, c2, c3]] → [a1, b1, c1, a2, c2, c3]. */
function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}
