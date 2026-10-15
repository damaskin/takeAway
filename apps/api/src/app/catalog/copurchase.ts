import type { StoreMenu } from '@takeaway/shared-types';

/** How far back the baskets are read. */
export const COPURCHASE_WINDOW_DAYS = 90;

/**
 * Baskets — counted orders holding a product in hand and something else —
 * needed before what people bought together beats the menu rule. Below it a
 * single regular's habit would read as everyone's.
 */
export const COPURCHASE_MIN_BASKETS = 20;

/** Orders a product must share with the products in hand to be offered as bought «often» with them. */
export const COPURCHASE_MIN_ORDERS = 3;

/** A product and the number of baskets it was in. */
export interface CoPurchase {
  productId: string;
  orders: number;
}

/**
 * One row of the co-purchase query: a product bought with those in hand,
 * counted in this store's baskets and in the whole brand's. The row with a
 * null `productId` carries the number of baskets themselves.
 */
export interface CoPurchaseRow {
  productId: string | null;
  here: number;
  brand: number;
}

/**
 * What customers bought together with the products in hand, most often
 * first: the store's own baskets when it has enough of them, else the
 * brand's (a new store of an established café), else null — too little to
 * go on, the menu rule decides.
 */
export function rankCoPurchases(rows: readonly CoPurchaseRow[]): CoPurchase[] | null {
  const baskets = rows.find((row) => row.productId === null);
  const scope =
    (baskets?.here ?? 0) >= COPURCHASE_MIN_BASKETS
      ? 'here'
      : (baskets?.brand ?? 0) >= COPURCHASE_MIN_BASKETS
        ? 'brand'
        : null;
  if (!scope) return null;
  return rows
    .flatMap((row) =>
      row.productId !== null && row[scope] >= COPURCHASE_MIN_ORDERS
        ? [{ productId: row.productId, orders: row[scope] }]
        : [],
    )
    .sort((a, b) => b.orders - a.orders);
}

/**
 * The co-purchased products the store can offer now, best first: on its
 * menu (which carries only what it sells, without hidden and add-ons-only
 * categories), not sold out, not in hand, at most [limit]. Equal counts go
 * by the menu's order.
 */
export function pickCoPurchased(
  menu: Pick<StoreMenu, 'categories'>,
  ranked: readonly CoPurchase[],
  inHand: readonly string[],
  limit: number,
): string[] {
  const position = new Map<string, number>();
  for (const category of menu.categories) {
    for (const product of category.products) {
      if (!product.onStopList) position.set(product.id, position.size);
    }
  }
  const taken = new Set(inHand);
  return ranked
    .filter((c) => position.has(c.productId) && !taken.has(c.productId))
    .sort((a, b) => b.orders - a.orders || (position.get(a.productId) ?? 0) - (position.get(b.productId) ?? 0))
    .slice(0, Math.max(0, limit))
    .map((c) => c.productId);
}
