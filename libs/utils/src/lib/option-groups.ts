import type {
  OptionLine,
  OptionPickError,
  OptionSelection,
  ProductOptionGroup,
  ProductOptionItem,
} from '@takeaway/shared-types';
import { OPTION_MAX_QTY_LIMIT } from '@takeaway/shared-types';

/**
 * The rules of the options catalog («Добавки и варианты», item 17), shared
 * by the API (which re-checks and re-prices every line it is sent) and the
 * product pages (which price the choice live). One implementation, so the
 * price on the card, in the cart and on the order cannot drift apart.
 *
 * A choice is held as {@link OptionPicks}: option id → how many (1 for A and
 * B). An option that is not in the map, or is at 0, is not taken.
 */
export type OptionPicks = Readonly<Record<string, number>>;

/** The order a product page asks in: variants first, then add-ons, each kind in the order given. */
export function orderOptionGroups<T extends Pick<ProductOptionGroup, 'kind'>>(groups: readonly T[]): T[] {
  return [...groups.filter((g) => g.kind === 'VARIANT'), ...groups.filter((g) => g.kind !== 'VARIANT')];
}

/** The fewest and most options of an A group that may be picked. */
export function selectBounds(group: ProductOptionGroup): { min: number; max: number } {
  const max = Math.max(1, group.maxSelect ?? group.options.length);
  const min = Math.max(group.kind === 'VARIANT' ? 1 : 0, group.minSelect ?? 0);
  return { min: Math.min(min, max), max };
}

/** The bounds of a C option's counter. */
export function qtyBounds(option: Pick<ProductOptionItem, 'minQty' | 'maxQty'>): { min: number; max: number } {
  const min = Math.max(0, option.minQty ?? 0);
  return { min, max: Math.max(min, Math.min(option.maxQty ?? OPTION_MAX_QTY_LIMIT, OPTION_MAX_QTY_LIMIT)) };
}

/** How many units of a C option the base price already includes (the meat in a shawarma). */
export function freeQty(
  group: Pick<ProductOptionGroup, 'type'>,
  option: Pick<ProductOptionItem, 'defaultQty'>,
): number {
  return group.type === 'C' ? Math.max(0, option.defaultQty ?? 0) : 0;
}

/**
 * Whether a group is shown for this choice: always without a condition, and
 * always when the condition's option is not on the product (a cola has no
 * «Подача», so its «Лёд» is always there); otherwise only while that option
 * is picked and its own group is shown.
 */
export function isGroupVisible(
  group: Pick<ProductOptionGroup, 'id' | 'showIfOptionId'>,
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
): boolean {
  return isVisible(group, groups, picks, new Set());
}

function isVisible(
  group: Pick<ProductOptionGroup, 'id' | 'showIfOptionId'>,
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
  seen: Set<string>,
): boolean {
  if (!group.showIfOptionId) return true;
  const owner = groups.find((g) => g.options.some((o) => o.id === group.showIfOptionId));
  if (!owner) return true;
  if (seen.has(group.id)) return false; // a loop of conditions shows nothing
  seen.add(group.id);
  return (picks[group.showIfOptionId] ?? 0) > 0 && isVisible(owner, groups, picks, seen);
}

/** The groups shown for this choice, in the order given. */
export function visibleOptionGroups(groups: readonly ProductOptionGroup[], picks: OptionPicks): ProductOptionGroup[] {
  return groups.filter((group) => isGroupVisible(group, groups, picks));
}

/**
 * The choice with the picks of hidden groups dropped (and zeros removed) —
 * what is left after the customer switches iced back to hot.
 */
export function normalizeOptionPicks(
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of visibleOptionGroups(groups, picks)) {
    for (const option of group.options) {
      const qty = picks[option.id] ?? 0;
      if (qty > 0) out[option.id] = qty;
    }
  }
  // Dropping a pick can hide another group (its condition): settle again.
  return Object.keys(out).length === Object.keys(picks).filter((id) => (picks[id] ?? 0) > 0).length
    ? out
    : normalizeOptionPicks(groups, out);
}

/**
 * What the product page starts with: every available default of A and B
 * (up to the group's maximum), every C option at its `defaultQty`, then the
 * picks of groups hidden by that choice dropped. A required variant without
 * a default stays unpicked — the customer has to choose it.
 */
export function defaultOptionPicks(groups: readonly ProductOptionGroup[]): Record<string, number> {
  const picks: Record<string, number> = {};
  for (const group of groups) {
    if (group.type === 'C') {
      for (const option of group.options) {
        if (!option.available) continue;
        const { min, max } = qtyBounds(option);
        const qty = Math.min(Math.max(option.defaultQty ?? 0, min), max);
        if (qty > 0) picks[option.id] = qty;
      }
      continue;
    }
    const defaults = group.options.filter((o) => o.isDefault && o.available);
    const limit = group.type === 'A' ? selectBounds(group).max : defaults.length;
    for (const option of defaults.slice(0, limit)) picks[option.id] = 1;
  }
  return normalizeOptionPicks(groups, picks);
}

/**
 * The choice after a tap on an A or B option. A one-of group (max 1) moves
 * its pick there; tapping the picked option again clears it unless the group
 * needs one. A several-of group adds or removes it, and refuses one above
 * its maximum. B switches it. An unavailable option cannot be switched on.
 * Groups the change hides lose their picks.
 */
export function toggleOptionPick(
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
  optionId: string,
): Record<string, number> {
  const found = findOption(groups, optionId);
  if (!found || found.group.type === 'C') return { ...picks };
  const { group, option } = found;
  const on = (picks[optionId] ?? 0) > 0;
  const next: Record<string, number> = { ...picks };
  if (on) {
    const picked = group.options.filter((o) => (picks[o.id] ?? 0) > 0).length;
    if (group.type === 'A' && selectBounds(group).max === 1 && picked <= selectBounds(group).min) return next;
    delete next[optionId];
    return normalizeOptionPicks(groups, next);
  }
  if (!option.available) return next;
  if (group.type === 'A') {
    const { max } = selectBounds(group);
    if (max === 1) {
      for (const other of group.options) delete next[other.id];
    } else if (group.options.filter((o) => (picks[o.id] ?? 0) > 0).length >= max) {
      return next;
    }
  }
  next[optionId] = 1;
  return normalizeOptionPicks(groups, next);
}

/** The choice with a C option's counter set to `qty`, kept within its bounds. */
export function setOptionQty(
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
  optionId: string,
  qty: number,
): Record<string, number> {
  const found = findOption(groups, optionId);
  if (!found || found.group.type !== 'C') return { ...picks };
  const { option } = found;
  const { min, max } = qtyBounds(option);
  const next: Record<string, number> = { ...picks };
  const wanted = Math.min(Math.max(Math.trunc(qty), min), max);
  if (!option.available && wanted > (picks[optionId] ?? 0)) return next;
  if (wanted > 0) next[optionId] = wanted;
  else delete next[optionId];
  return normalizeOptionPicks(groups, next);
}

/**
 * Everything that keeps the choice out of the cart, in page order; empty
 * when it can go in. The API answers 400 with the first one.
 */
export function validateOptionPicks(groups: readonly ProductOptionGroup[], picks: OptionPicks): OptionPickError[] {
  const errors: OptionPickError[] = [];
  for (const [optionId, qty] of Object.entries(picks)) {
    if (qty === 0) continue;
    const found = findOption(groups, optionId);
    if (!found) errors.push({ code: 'UNKNOWN_OPTION', groupId: null, optionId });
    else if (!Number.isInteger(qty) || qty < 0) errors.push({ code: 'BAD_QTY', groupId: found.group.id, optionId });
  }
  if (errors.length) return errors;

  for (const group of groups) {
    const visible = isGroupVisible(group, groups, picks);
    const picked = group.options.filter((o) => (picks[o.id] ?? 0) > 0);
    if (!visible) {
      const first = picked[0];
      if (first) errors.push({ code: 'HIDDEN_GROUP', groupId: group.id, optionId: first.id });
      continue;
    }
    for (const option of picked) {
      if (!option.available) errors.push({ code: 'OPTION_UNAVAILABLE', groupId: group.id, optionId: option.id });
      if (group.type !== 'C' && picks[option.id] !== 1)
        errors.push({ code: 'BAD_QTY', groupId: group.id, optionId: option.id });
    }
    if (group.type === 'A') {
      const { min, max } = selectBounds(group);
      if (picked.length < min) errors.push({ code: 'TOO_FEW', groupId: group.id, optionId: null });
      if (picked.length > max) errors.push({ code: 'TOO_MANY', groupId: group.id, optionId: null });
    } else if (group.type === 'C') {
      for (const option of group.options) {
        const qty = picks[option.id] ?? 0;
        const { min, max } = qtyBounds(option);
        if (qty < min) {
          errors.push({
            code: option.available ? 'TOO_FEW' : 'OPTION_UNAVAILABLE',
            groupId: group.id,
            optionId: option.id,
          });
        }
        if (qty > max) errors.push({ code: 'TOO_MANY', groupId: group.id, optionId: option.id });
      }
    }
  }
  return errors;
}

/**
 * The product cannot go in with one tap: what the page starts with is not a
 * valid choice (a size to pick, meat that has run out). Defaults that make a
 * valid choice do not stop a quick add, as sizes with a default never did.
 */
export function needsOptionChoice(groups: readonly ProductOptionGroup[]): boolean {
  return validateOptionPicks(groups, defaultOptionPicks(groups)).length > 0;
}

/**
 * The picked options as order lines, in page order: the groups in the order
 * given, each group's options in theirs. Hidden groups and zeros are left out.
 */
export function optionLinesFor(groups: readonly ProductOptionGroup[], picks: OptionPicks): OptionLine[] {
  const lines: OptionLine[] = [];
  for (const group of visibleOptionGroups(groups, picks)) {
    for (const option of group.options) {
      const qty = picks[option.id] ?? 0;
      if (qty <= 0) continue;
      const free = freeQty(group, option);
      lines.push({
        groupId: group.id,
        groupName: group.name,
        kind: group.kind,
        type: group.type,
        optionId: option.id,
        name: option.name,
        qty,
        unitPriceCents: option.priceCents,
        freeQty: free,
        totalCents: group.type === 'C' ? option.priceCents * Math.max(0, qty - free) : option.priceCents,
      });
    }
  }
  return lines;
}

/**
 * One item with this choice: the base price, plus each picked variant's and
 * A/B add-on's price, plus each C add-on's price for every unit above what
 * the base already includes.
 */
export function priceWithOptionPicks(
  basePriceCents: number,
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
): number {
  return optionLinesFor(groups, picks).reduce((cents, line) => cents + line.totalCents, basePriceCents);
}

/**
 * The choice in one run of text, as the kitchen and the receipt read it:
 * the variants joined by commas, then every add-on group on its own, its
 * options joined by « + », a count after ×. A C option left at the amount
 * the dish includes (one meat portion) is not mentioned.
 *
 * "M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2"
 */
export function describeOptionLines(lines: readonly OptionLine[]): string {
  const variants = lines.filter((l) => l.kind === 'VARIANT').map(lineText);
  const addonGroups = new Map<string, string[]>();
  for (const line of lines) {
    if (line.kind === 'VARIANT') continue;
    if (line.type === 'C' && line.freeQty > 0 && line.qty === line.freeQty) continue;
    const texts = addonGroups.get(line.groupId) ?? [];
    texts.push(lineText(line));
    addonGroups.set(line.groupId, texts);
  }
  return [variants.join(', '), ...[...addonGroups.values()].map((texts) => texts.join(' + '))]
    .filter((part) => part !== '')
    .join(' · ');
}

function lineText(line: OptionLine): string {
  return line.qty > 1 ? `${line.name} ×${line.qty}` : line.name;
}

/** The choice as the API takes it, in a stable order (option id). */
export function toOptionSelections(picks: OptionPicks): OptionSelection[] {
  return Object.entries(picks)
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([optionId, qty]) => ({ optionId, qty }));
}

/** The choice from the API's form. Repeated options add up. */
export function fromOptionSelections(selections: readonly OptionSelection[]): Record<string, number> {
  const picks: Record<string, number> = {};
  for (const { optionId, qty } of selections) picks[optionId] = (picks[optionId] ?? 0) + qty;
  return picks;
}

/**
 * Two cart lines of one product with the same key are the same thing and
 * merge into one line; a different choice is a different line.
 */
export function optionSelectionKey(selections: readonly OptionSelection[]): string {
  return toOptionSelections(fromOptionSelections(selections))
    .map(({ optionId, qty }) => `${optionId}:${qty}`)
    .join(',');
}

function findOption(
  groups: readonly ProductOptionGroup[],
  optionId: string,
): { group: ProductOptionGroup; option: ProductOptionItem } | null {
  for (const group of groups) {
    const option = group.options.find((o) => o.id === optionId);
    if (option) return { group, option };
  }
  return null;
}
