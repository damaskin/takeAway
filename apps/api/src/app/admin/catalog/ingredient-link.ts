import type { Prisma } from '@prisma/client';

import type { BrandScope } from './admin-catalog.service';
import { menuBadRequest, menuForbidden } from './admin-menu.errors';

/** The library entry an option being written is linked to. */
export interface LinkedIngredient {
  id: string;
  name: string;
  priceCents: number;
  /** The add-on group an extra made of it starts in. */
  group: string | null;
}

const LINKED = { id: true, name: true, priceCents: true, group: true } as const satisfies Prisma.IngredientSelect;

/**
 * Whether the caller may add entries to a brand's add-ons library and take
 * them out: the platform team only (a `null` scope is SUPER_ADMIN's) since
 * 2026-11-06. A brand switches its add-ins on and off and sets their prices,
 * and puts the ones its library has on products.
 */
export function mayEditLibrary(scope: BrandScope): boolean {
  return scope === null;
}

/** A brand reaching for an add-in its library lacks: only the takeAway team adds one. */
export function notInLibrary(): never {
  throw menuForbidden(
    'INGREDIENT_NOT_IN_LIBRARY',
    'This add-in is not in the brand library; pick one that is, or ask the takeAway team to add it',
  );
}

export interface LinkOptions {
  /**
   * The option is an add-on that is stocked (an extra, or a milk): given by
   * name only, it is filed under the library entry of that name.
   */
  autoLink: boolean;
  /**
   * The caller may add a missing entry to the library (see {@link mayEditLibrary}).
   * Otherwise a stocked option must be one the library has, and cannot be
   * created untracked either.
   */
  mayAdd: boolean;
  /** Price and add-on group of an entry made for the option. */
  priceForNew?: number;
  groupForNew?: string | null;
}

/**
 * The library entry («Добавки») an option being written should point at.
 *
 * - `null` — not tracked; the option is always shown. For a stocked option
 *   being created that is the platform team's call only.
 * - an id — must be in the product's brand library.
 * - omitted with `autoLink` — the library entry of the option's name. The
 *   platform team's editor makes it if the brand has none yet (at
 *   `priceForNew`, the price the option is being given, and in
 *   `groupForNew`, its add-on group), so every new extra lands in the
 *   library and two products' «Овсяное молоко» share one switch. A brand's
 *   editor finds it (whatever the letter case) or is refused.
 * - omitted otherwise — `undefined`, the link is left as it is.
 */
export async function linkedIngredient(
  db: Prisma.TransactionClient,
  brandId: string,
  requested: string | null | undefined,
  name: string | undefined,
  options: LinkOptions,
): Promise<LinkedIngredient | null | undefined> {
  const { autoLink, mayAdd, priceForNew = 0, groupForNew = null } = options;
  if (requested === null) {
    if (autoLink && !mayAdd) notInLibrary();
    return null;
  }
  if (requested !== undefined) {
    const found = await db.ingredient.findFirst({ where: { id: requested, brandId }, select: LINKED });
    if (!found) throw menuBadRequest('INGREDIENT_UNKNOWN', 'This ingredient is not in the brand library');
    return found;
  }
  const trimmed = name?.trim();
  if (!autoLink || !trimmed) return undefined;
  if (!mayAdd) {
    const found = await db.ingredient.findFirst({
      where: { brandId, name: { equals: trimmed, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: LINKED,
    });
    return found ?? notInLibrary();
  }
  return db.ingredient.upsert({
    where: { brandId_name: { brandId, name: trimmed } },
    update: {},
    create: { brandId, name: trimmed, priceCents: priceForNew, group: groupForNew },
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

/**
 * The add-on group a new extra goes in: the one asked for (`null` = the
 * generic «Добавки»), else its library entry's — picking «Ваниль» from the
 * library puts it under «Сиропы».
 */
export function optionGroup(
  requested: string | null | undefined,
  linked: LinkedIngredient | null | undefined,
): string | null {
  return requested !== undefined ? requested : (linked?.group ?? null);
}
