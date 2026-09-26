import type { Prisma } from '@prisma/client';

import { menuBadRequest } from './admin-menu.errors';

/**
 * The ingredient an option being written should point at.
 *
 * - `null` — not tracked; the option is always shown.
 * - an id — must be in the product's brand library.
 * - omitted with `autoLink` — the library entry of the option's name, made
 *   if the brand has none yet, so every new extra lands in the library and
 *   two products' «Овсяное молоко» share one switch.
 * - omitted otherwise — `undefined`, the link is left as it is.
 */
export async function ingredientIdFor(
  db: Prisma.TransactionClient,
  brandId: string,
  requested: string | null | undefined,
  name: string | undefined,
  autoLink: boolean,
): Promise<string | null | undefined> {
  if (requested === null) return null;
  if (requested !== undefined) {
    const found = await db.ingredient.findFirst({ where: { id: requested, brandId }, select: { id: true } });
    if (!found) throw menuBadRequest('INGREDIENT_UNKNOWN', 'This ingredient is not in the brand library');
    return found.id;
  }
  const trimmed = name?.trim();
  if (!autoLink || !trimmed) return undefined;
  const row = await db.ingredient.upsert({
    where: { brandId_name: { brandId, name: trimmed } },
    update: {},
    create: { brandId, name: trimmed },
    select: { id: true },
  });
  return row.id;
}
