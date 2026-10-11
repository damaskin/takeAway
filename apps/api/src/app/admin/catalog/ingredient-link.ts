import type { Prisma } from '@prisma/client';

import { menuBadRequest } from './admin-menu.errors';

/** The library entry an option being written is linked to. */
export interface LinkedIngredient {
  id: string;
  name: string;
  priceCents: number;
}

const LINKED = { id: true, name: true, priceCents: true } as const satisfies Prisma.IngredientSelect;

/**
 * The library entry («Добавки») an option being written should point at.
 *
 * - `null` — not tracked; the option is always shown.
 * - an id — must be in the product's brand library.
 * - omitted with `autoLink` — the library entry of the option's name, made
 *   if the brand has none yet (at `priceForNew`, the price the option is
 *   being given), so every new extra lands in the library and two
 *   products' «Овсяное молоко» share one switch.
 * - omitted otherwise — `undefined`, the link is left as it is.
 */
export async function linkedIngredient(
  db: Prisma.TransactionClient,
  brandId: string,
  requested: string | null | undefined,
  name: string | undefined,
  autoLink: boolean,
  priceForNew = 0,
): Promise<LinkedIngredient | null | undefined> {
  if (requested === null) return null;
  if (requested !== undefined) {
    const found = await db.ingredient.findFirst({ where: { id: requested, brandId }, select: LINKED });
    if (!found) throw menuBadRequest('INGREDIENT_UNKNOWN', 'This ingredient is not in the brand library');
    return found;
  }
  const trimmed = name?.trim();
  if (!autoLink || !trimmed) return undefined;
  return db.ingredient.upsert({
    where: { brandId_name: { brandId, name: trimmed } },
    update: {},
    create: { brandId, name: trimmed, priceCents: priceForNew },
    select: LINKED,
  });
}

/** The `ingredientId` to write for a {@link linkedIngredient} answer: `undefined` leaves the column alone. */
export function linkId(linked: LinkedIngredient | null | undefined): string | null | undefined {
  return linked === undefined || linked === null ? linked : linked.id;
}

/**
 * Name and price of a new option, filled from its library entry where the
 * editor left them out — picking «Ванильный сироп» from the library is
 * enough to put it on a product at its usual price.
 */
export function optionDefaults(
  dto: { name?: string; priceDeltaCents?: number },
  linked: LinkedIngredient | null | undefined,
): { name: string; priceDeltaCents: number } {
  const name = dto.name?.trim() || linked?.name;
  if (!name) throw menuBadRequest('OPTION_NAME_REQUIRED', 'An option needs a name or an add-on from the library');
  return { name, priceDeltaCents: dto.priceDeltaCents ?? linked?.priceCents ?? 0 };
}
