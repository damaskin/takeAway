import type { CategoryOptionKind, Prisma, VariationType } from '@prisma/client';

import { slugify } from '../../common/text/slug';

/** An option of a category's set, as the copy reads it. */
export interface SetOption {
  kind: CategoryOptionKind;
  variationType: VariationType | null;
  name: string;
  priceDeltaCents: number;
  group: string | null;
  isDefault: boolean;
  maxCount: number;
  ingredientId: string | null;
}

/** What a product already offers, as the copy reads it. */
export interface ProductOptions {
  variations: ReadonlyArray<{
    type: VariationType;
    name: string;
    isDefault: boolean;
    ingredientId: string | null;
    sortOrder: number;
  }>;
  modifiers: ReadonlyArray<{ slug: string; name: string; ingredientId: string | null; sortOrder: number }>;
}

export interface PlannedVariation {
  type: VariationType;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
  ingredientId: string | null;
  sortOrder: number;
}

export interface PlannedModifier {
  slug: string;
  name: string;
  priceDeltaCents: number;
  group: string | null;
  maxCount: number;
  ingredientId: string | null;
  sortOrder: number;
}

export interface OptionCopyPlan {
  variations: PlannedVariation[];
  modifiers: PlannedModifier[];
}

/**
 * Pick-one groups whose choices are a product's own scheme: a product that
 * already sells «0,3 л / 0,4 л» does not also get «Маленький / Большой».
 * They are copied as a whole group, only to a product without one. Milk is
 * an add-on from the library and is merged choice by choice.
 */
const WHOLE_GROUP_TYPES: ReadonlySet<VariationType> = new Set<VariationType>(['SIZE', 'TEMPERATURE', 'CUP']);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The same add-on: the same library entry, or the same name when either is not in the library. */
function sameOption(
  a: { name: string; ingredientId: string | null },
  b: { name: string; ingredientId: string | null },
): boolean {
  if (a.ingredientId && b.ingredientId) return a.ingredientId === b.ingredientId;
  return sameName(a.name, b.name);
}

const nextSort = (rows: ReadonlyArray<{ sortOrder: number }>) =>
  rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;

/**
 * What a category's option set adds to one product: only what the product
 * does not offer yet. Nothing it has is removed or changed — not a price,
 * not a name, not which choice is the default — so running it again adds
 * nothing. A default choice is set only in a group that had none.
 */
export function planOptionCopy(set: readonly SetOption[], product: ProductOptions): OptionCopyPlan {
  const variations: PlannedVariation[] = [];
  const modifiers: PlannedModifier[] = [];
  const slugs = new Set(product.modifiers.map((m) => m.slug));

  for (const option of set) {
    if (option.kind === 'VARIATION') {
      const type = option.variationType;
      if (!type) continue;
      const existing = product.variations.filter((v) => v.type === type);
      const planned = variations.filter((v) => v.type === type);
      if (WHOLE_GROUP_TYPES.has(type) && existing.length > 0) continue;
      if ([...existing, ...planned].some((v) => sameOption(v, option))) continue;
      const hasDefault = [...existing, ...planned].some((v) => v.isDefault);
      variations.push({
        type,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents,
        isDefault: option.isDefault && !hasDefault,
        ingredientId: option.ingredientId,
        sortOrder: nextSort([...existing, ...planned]),
      });
      continue;
    }

    if ([...product.modifiers, ...modifiers].some((m) => sameOption(m, option))) continue;
    const slug = freeSlug(option.name, slugs);
    slugs.add(slug);
    modifiers.push({
      slug,
      name: option.name,
      priceDeltaCents: option.priceDeltaCents,
      group: option.group,
      maxCount: option.maxCount,
      ingredientId: option.ingredientId,
      sortOrder: nextSort([...product.modifiers, ...modifiers]),
    });
  }
  return { variations, modifiers };
}

/** The first slug for `name` the product does not use yet: `vanil`, `vanil-2`, … */
function freeSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name, 56) || 'option';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface OptionCopyResult {
  /** Products looked at; 0 when the category has no set. */
  total: number;
  /** Products that got at least one option. */
  products: number;
  variations: number;
  modifiers: number;
}

const PRODUCT_OPTIONS = {
  id: true,
  variations: { select: { type: true, name: true, isDefault: true, ingredientId: true, sortOrder: true } },
  modifiers: { select: { slug: true, name: true, ingredientId: true, sortOrder: true } },
} as const satisfies Prisma.ProductSelect;

/**
 * Copies a category's option set onto its products — all of them, or the
 * ones named — adding only what each one lacks (see {@link planOptionCopy}).
 * The copies are ordinary product options linked to the same library
 * entries, so the stop-list and library price changes reach them, and the
 * cart prices them like any other option.
 */
export async function copyCategoryOptions(
  db: Prisma.TransactionClient,
  categoryId: string,
  productIds?: readonly string[],
): Promise<OptionCopyResult> {
  const set = await db.categoryOption.findMany({
    where: { categoryId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  // Without a set there is nothing to copy (and no product worth loading).
  if (set.length === 0) return { total: 0, products: 0, variations: 0, modifiers: 0 };
  const products = await db.product.findMany({
    where: productIds ? { id: { in: [...productIds] }, categoryId } : { categoryId },
    select: PRODUCT_OPTIONS,
  });
  const result: OptionCopyResult = { total: products.length, products: 0, variations: 0, modifiers: 0 };

  for (const product of products) {
    const plan = planOptionCopy(set, product);
    if (plan.variations.length === 0 && plan.modifiers.length === 0) continue;
    if (plan.variations.length > 0) {
      await db.variation.createMany({ data: plan.variations.map((v) => ({ productId: product.id, ...v })) });
    }
    if (plan.modifiers.length > 0) {
      await db.modifier.createMany({ data: plan.modifiers.map((m) => ({ productId: product.id, ...m })) });
    }
    result.products += 1;
    result.variations += plan.variations.length;
    result.modifiers += plan.modifiers.length;
  }
  return result;
}
