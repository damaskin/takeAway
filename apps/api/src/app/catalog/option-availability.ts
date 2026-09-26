import type { Prisma } from '@prisma/client';

/**
 * The options a customer may see and order: those not tied to an
 * ingredient, and those whose ingredient is in stock. Every place that
 * shows or prices options for a customer loads them through this filter,
 * so an ingredient switched off in the library disappears from the product
 * screen, is refused by the cart, and drops a waiting cart line at checkout
 * — while the product itself stays on the menu.
 */
export const AVAILABLE_OPTION = {
  OR: [{ ingredientId: null }, { ingredient: { isAvailable: true } }],
} satisfies Prisma.ModifierWhereInput & Prisma.VariationWhereInput;

/** `include` for a product priced for a customer: only the options on sale. */
export const AVAILABLE_OPTIONS_INCLUDE = {
  variations: { where: AVAILABLE_OPTION },
  modifiers: { where: AVAILABLE_OPTION },
} satisfies Prisma.ProductInclude;
