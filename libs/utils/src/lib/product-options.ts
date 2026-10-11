import type { Modifier, OrderItemModifier, OrderItemVariation, Variation, VariationType } from '@takeaway/shared-types';

import { describeOrderItemOptions } from './order-item';

/**
 * The order a product page asks in: the size first — it sets the price and
 * the cup — then hot or iced, the milk and the cup.
 */
export const VARIATION_GROUP_ORDER: readonly VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

/** The options of one type: the customer picks exactly one. */
export interface VariationGroup {
  type: VariationType;
  variations: Variation[];
}

/** Which option of each type is picked, by variation id. */
export type VariationSelection = Partial<Record<VariationType, string>>;

/** Add-ons under one heading — «Сиропы», «Соусы», «Убрать». */
export interface ModifierGroup {
  /** The heading as the business named it; null for the general «Добавки». */
  name: string | null;
  modifiers: Modifier[];
  /** Something in the group has to be taken: an add-on with a minimum above zero. */
  required: boolean;
}

/** What a product's options are priced and described from. */
export interface ProductOptions {
  basePriceCents: number;
  variations: readonly Variation[];
  modifiers: readonly Modifier[];
}

/**
 * A group per variation type, in {@link VARIATION_GROUP_ORDER}, each with its
 * options in the menu's order. A type the product does not offer is left out.
 */
export function groupVariations(variations: readonly Variation[]): VariationGroup[] {
  return VARIATION_GROUP_ORDER.map((type) => ({
    type,
    variations: variations.filter((v) => v.type === type).sort((a, b) => a.sortOrder - b.sortOrder),
  })).filter((group) => group.variations.length > 0);
}

/** The option of each type the business marked default, else the first one listed. */
export function defaultVariationSelection(variations: readonly Variation[]): VariationSelection {
  const selection: VariationSelection = {};
  for (const group of groupVariations(variations)) {
    const pick = group.variations.find((v) => v.isDefault) ?? group.variations[0];
    if (pick) selection[group.type] = pick.id;
  }
  return selection;
}

/**
 * Add-ons by their display group. Groups come in the order of their first
 * add-on on the menu, add-ons in the menu's order; an add-on with no group,
 * or a blank one, joins the general group.
 */
export function groupModifiers(modifiers: readonly Modifier[]): ModifierGroup[] {
  const groups = new Map<string | null, ModifierGroup>();
  for (const modifier of [...modifiers].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const name = modifier.group?.trim() || null;
    let group = groups.get(name);
    if (!group) {
      group = { name, modifiers: [], required: false };
      groups.set(name, group);
    }
    group.modifiers.push(modifier);
    if (modifier.minCount > 0) group.required = true;
  }
  return [...groups.values()];
}

/** Every add-on at its minimum: a required one is already in, the rest are not. */
export function initialModifierCounts(modifiers: readonly Modifier[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const modifier of modifiers) counts[modifier.id] = modifier.minCount;
  return counts;
}

/** The count kept within what the business allows for the add-on. */
export function clampModifierCount(modifier: Pick<Modifier, 'minCount' | 'maxCount'>, count: number): number {
  return Math.min(Math.max(count, modifier.minCount), Math.max(modifier.minCount, modifier.maxCount));
}

/** The add-ons taken, in the order given, each with its count. */
export function chosenModifiers(
  modifiers: readonly Modifier[],
  counts: Readonly<Record<string, number>>,
): { modifier: Modifier; count: number }[] {
  return modifiers
    .map((modifier) => ({ modifier, count: counts[modifier.id] ?? 0 }))
    .filter((chosen) => chosen.count > 0);
}

/** One of the product with the options picked: base price, the picked options' deltas, each add-on × its count. */
export function priceWithOptions(
  product: ProductOptions,
  selection: VariationSelection,
  counts: Readonly<Record<string, number>>,
): number {
  let cents = product.basePriceCents;
  for (const variation of product.variations) {
    if (selection[variation.type] === variation.id) cents += variation.priceDeltaCents;
  }
  for (const modifier of product.modifiers) cents += (counts[modifier.id] ?? 0) * modifier.priceDeltaCents;
  return cents;
}

/**
 * The choice in one line, for next to the add button: "L · Oat · +Vanilla ×2".
 * Worded as the order screen and the receipt word a line, and in the order
 * the page lists the options. Empty when the product has none.
 */
export function describeChoice(
  product: Omit<ProductOptions, 'basePriceCents'>,
  selection: VariationSelection,
  counts: Readonly<Record<string, number>>,
): string {
  const variations: OrderItemVariation[] = groupVariations(product.variations).flatMap((group) => {
    const picked = group.variations.find((v) => v.id === selection[group.type]);
    return picked
      ? [{ id: picked.id, type: picked.type, name: picked.name, priceDeltaCents: picked.priceDeltaCents }]
      : [];
  });
  const inPageOrder = groupModifiers(product.modifiers).flatMap((group) => group.modifiers);
  const modifierLines: OrderItemModifier[] = chosenModifiers(inPageOrder, counts).map(({ modifier, count }) => ({
    id: modifier.id,
    name: modifier.name,
    count,
    priceCents: modifier.priceDeltaCents,
  }));
  return describeOrderItemOptions({ variations, modifierLines });
}

/**
 * The product cannot be added with a single tap: some add-on has to be
 * taken, and the customer should see it — and its price — before it goes in.
 * Sizes and milks always have a default, so they never stop a quick add.
 */
export function hasRequiredOptions(product: { modifiers: readonly Pick<Modifier, 'minCount'>[] }): boolean {
  return product.modifiers.some((modifier) => modifier.minCount > 0);
}
