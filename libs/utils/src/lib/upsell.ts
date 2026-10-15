import type {
  CategoryKind,
  ProductSummary,
  StoreMenu,
  StoreSuggestions,
  SuggestionSource,
} from '@takeaway/shared-types';

import { isDrinkKind, isFoodKind, menuProductKinds, productKind } from './product-kind';

/** A product offered next to those in hand, with its kind for the placeholder. */
export interface ProductSuggestion {
  product: ProductSummary;
  kind: CategoryKind;
}

/** A row of suggestions and where it came from — the title follows `source`. */
export interface SuggestionRow {
  items: ProductSuggestion[];
  source: SuggestionSource;
}

/**
 * The suggestions row next to [productIds] — the cart's lines, or the
 * product on screen — from the store's answer to
 * `GET /stores/:id/suggestions` (`answer`):
 *
 * - `copurchase`: what customers bought together with them, in the API's
 *   order. The only case the row may be titled «Часто берут вместе».
 * - `rule`, a failed call (`null` — offline, or an API from before the
 *   endpoint), or nothing that is still on this menu and in stock: the menu
 *   rule, {@link suggestFood}, under the old titles.
 * - `undefined`, the answer still on its way: nothing yet, so the row does
 *   not change its products and title under the customer's thumb.
 */
export function suggestionRow(
  menu: Pick<StoreMenu, 'categories'> | null | undefined,
  productIds: readonly string[],
  answer: StoreSuggestions | null | undefined,
  limit = 6,
): SuggestionRow {
  if (!menu || answer === undefined) return { items: [], source: 'rule' };
  if (answer?.source === 'copurchase') {
    const items = fromMenu(menu, answer.productIds, productIds).slice(0, Math.max(0, limit));
    if (items.length > 0) return { items, source: 'copurchase' };
  }
  return { items: suggestFood(menu, productIds, limit), source: 'rule' };
}

/** [ids] as products of [menu] in that order: those it still sells, in stock and not in hand. */
function fromMenu(
  menu: Pick<StoreMenu, 'categories'>,
  ids: readonly string[],
  inHand: readonly string[],
): ProductSuggestion[] {
  const onMenu = new Map<string, ProductSuggestion>();
  for (const category of menu.categories) {
    for (const product of category.products) {
      if (!product.onStopList) onMenu.set(product.id, { product, kind: productKind(product, category) });
    }
  }
  const taken = new Set(inHand);
  return ids.flatMap((id) => {
    const suggestion = onMenu.get(id);
    if (!suggestion || taken.has(id)) return [];
    taken.add(id);
    return [suggestion];
  });
}

/**
 * Something to eat with the drinks — «Добавить к напитку?» in the cart,
 * «К этому напитку» on a drink's page.
 *
 * Offered only while the products in hand (the cart's lines, or the drink on
 * screen) include a drink and nothing to eat yet. The offer is the menu's
 * bakery and food: in stock, not already in hand, at most [limit], the
 * categories taking turns so a long pastry list does not crowd out the
 * sandwiches. The store's menu carries only what it sells — hidden and
 * add-ons-only categories never reach it — so nothing else is filtered.
 * Kinds come from the menu: a product in hand that is not on it counts as
 * neither.
 *
 * A rule on the menu, not order statistics — which is why its titles do not
 * claim «often ordered together». The API answers with it while a store has
 * too few orders for co-purchases, and the clients fall back to it when the
 * API cannot be asked (see {@link suggestionRow}). The app does the same
 * (`upsell.dart`).
 */
export function suggestFood(
  menu: Pick<StoreMenu, 'categories'> | null | undefined,
  productIds: readonly string[],
  limit = 6,
): ProductSuggestion[] {
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
