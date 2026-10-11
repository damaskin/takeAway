/**
 * Where web and TMA serve the illustrations from
 * `libs/ui-kit/src/assets/product-placeholders` — each app copies that folder
 * to this path in its build (the assets glob in its project.json).
 */
export const PRODUCT_PLACEHOLDER_PATH = '/ui-kit/product-placeholders/';

/**
 * Category kinds as the API sends them (`CategoryKind` in shared-types),
 * spelled out so the kit stays free of app types. Anything else — a missing
 * kind, one this build does not know — draws the neutral bag.
 */
const FILES: ReadonlyMap<string, string> = new Map([
  ['HOT_DRINKS', 'hot-drink.svg'],
  ['COLD_DRINKS', 'cold-drink.svg'],
  ['FOOD', 'food.svg'],
  ['BAKERY', 'bakery.svg'],
]);

/** The illustration for a product without a photo, by its category kind. */
export function productPlaceholderSrc(kind: string | null | undefined): string {
  return PRODUCT_PLACEHOLDER_PATH + ((kind && FILES.get(kind)) || 'other.svg');
}
