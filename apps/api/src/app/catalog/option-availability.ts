import type { Prisma } from '@prisma/client';

/**
 * The options a customer may see and order: those not tied to an
 * ingredient, and those whose ingredient is in stock. Every place that
 * shows or prices options for a customer loads them through this filter,
 * so an ingredient switched off in the library disappears from the product
 * screen, is refused by the cart, and drops a waiting cart line at checkout
 * — while the product itself stays on the menu.
 *
 * Brand-wide only: use {@link availableOptionAt} wherever the store is known,
 * so a store that ran out of an ingredient on its own hides it too.
 */
export const AVAILABLE_OPTION = {
  OR: [{ ingredientId: null }, { ingredient: { isAvailable: true } }],
} satisfies Prisma.ModifierWhereInput & Prisma.VariationWhereInput;

/** A stop that still holds: no expiry, or one still ahead. */
export function activeStopWhere(now: Date = new Date()) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } satisfies Prisma.StoreIngredientStopWhereInput &
    Prisma.StopListEntryWhereInput;
}

/**
 * {@link AVAILABLE_OPTION} for one store: the ingredient must also not be
 * stopped in that store (see `StoreIngredientStop`).
 */
export function availableOptionAt(storeId: string, now: Date = new Date()) {
  return {
    OR: [
      { ingredientId: null },
      {
        ingredient: {
          isAvailable: true,
          storeStops: { none: { storeId, ...activeStopWhere(now) } },
        },
      },
    ],
  } satisfies Prisma.ModifierWhereInput & Prisma.VariationWhereInput;
}

/** `include` for a product priced for a customer of one store: only the options on sale there. */
export function availableOptionsIncludeAt(storeId: string, now: Date = new Date()) {
  const where = availableOptionAt(storeId, now);
  return {
    variations: { where },
    modifiers: { where },
  } satisfies Prisma.ProductInclude;
}
