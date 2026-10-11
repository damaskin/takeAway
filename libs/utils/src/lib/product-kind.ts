import type { CategoryKind, StoreMenu } from '@takeaway/shared-types';

/** Every category kind, in the order the admin lists them. */
export const CATEGORY_KINDS: readonly CategoryKind[] = ['HOT_DRINKS', 'COLD_DRINKS', 'FOOD', 'BAKERY', 'OTHER'];

const DRINK_KINDS: readonly CategoryKind[] = ['HOT_DRINKS', 'COLD_DRINKS'];
const FOOD_KINDS: readonly CategoryKind[] = ['FOOD', 'BAKERY'];

/**
 * What a product is: its own `categoryKind` when the API sends one, else the
 * kind of the menu category it sits in, else OTHER. An API that predates the
 * field, or a kind this build does not know, reads as OTHER — the neutral
 * placeholder and the plain wording, never a guess.
 */
export function productKind(
  product: { categoryKind?: string | null },
  category?: { kind?: string | null } | null,
): CategoryKind {
  return knownKind(product.categoryKind) ?? knownKind(category?.kind) ?? 'OTHER';
}

/** A hot or cold drink: the comment goes to the barista, caffeine is worth showing. */
export function isDrinkKind(kind: CategoryKind): boolean {
  return DRINK_KINDS.includes(kind);
}

/** Something to eat: no caffeine to speak of, and what the upsell offers next to a drink. */
export function isFoodKind(kind: CategoryKind): boolean {
  return FOOD_KINDS.includes(kind);
}

/** Each product of a menu with its kind, by product id. */
export function menuProductKinds(menu: Pick<StoreMenu, 'categories'>): Map<string, CategoryKind> {
  const kinds = new Map<string, CategoryKind>();
  for (const category of menu.categories) {
    for (const product of category.products) kinds.set(product.id, productKind(product, category));
  }
  return kinds;
}

function knownKind(value: string | null | undefined): CategoryKind | null {
  return value && (CATEGORY_KINDS as readonly string[]).includes(value) ? (value as CategoryKind) : null;
}
