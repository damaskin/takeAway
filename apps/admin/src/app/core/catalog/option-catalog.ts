import type {
  BrandOptionSetting,
  CatalogGroup,
  CatalogOption,
  OptionGroupKind,
  ProductOptionGroupsConfig,
  ProductOptionOverride,
} from '@takeaway/shared-types';
import { OPTION_MAX_QTY_LIMIT } from '@takeaway/shared-types';

/**
 * The admin's arithmetic over the options catalog (`docs/option-groups.md`):
 * ordering, the brand's settings with their defaults, the bounds a form
 * checks before the API does, and the product editor's draft. Pure, so the
 * pages stay templates and the rules get tests.
 */

/** Groups by `sortOrder` then name, each group's options the same way. */
export function sortCatalog(groups: readonly CatalogGroup[]): CatalogGroup[] {
  return [...groups].sort(bySortOrder).map((g) => ({ ...g, options: [...g.options].sort(bySortOrder) }));
}

/** The groups of one kind, in the order given. */
export function groupsOfKind<T extends Pick<CatalogGroup, 'kind'>>(groups: readonly T[], kind: OptionGroupKind): T[] {
  return groups.filter((g) => g.kind === kind);
}

function bySortOrder(a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** The `sortOrder` that puts a new entry after every one listed. */
export function nextSortOrder(list: readonly { sortOrder: number }[]): number {
  return list.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0);
}

/**
 * The `sortOrder` writes that move `list[index]` one place up (`-1`) or down
 * (`+1`): the two neighbours swap their numbers, or — when they share one —
 * the list is renumbered from 0 and only the rows that change are written.
 * Empty when there is nowhere to go.
 */
export function moveWrites(
  list: readonly { id: string; sortOrder: number }[],
  index: number,
  delta: -1 | 1,
): Array<{ id: string; sortOrder: number }> {
  const other = index + delta;
  const a = list[index];
  const b = list[other];
  if (!a || !b) return [];
  if (a.sortOrder !== b.sortOrder) {
    return [
      { id: a.id, sortOrder: b.sortOrder },
      { id: b.id, sortOrder: a.sortOrder },
    ];
  }
  const moved = [...list];
  moved[index] = b;
  moved[other] = a;
  return moved
    .map((row, i) => ({ id: row.id, sortOrder: i }))
    .filter((row, i) => moved[i]?.sortOrder !== row.sortOrder);
}

// ─── The brand's settings ───────────────────────────────────────────────────

/** Settings by option id. */
export function settingsById(settings: readonly BrandOptionSetting[]): Map<string, BrandOptionSetting> {
  return new Map(settings.map((s) => [s.optionId, s]));
}

/** No row means the brand has the option at price 0 and has not stopped it anywhere. */
export function settingFor(settings: ReadonlyMap<string, BrandOptionSetting>, optionId: string): BrandOptionSetting {
  return settings.get(optionId) ?? { optionId, priceCents: 0, enabled: true, stoppedStoreIds: [] };
}

/** The options of a group the brand has (switched-off ones are hidden from its product editor). */
export function offeredOptions(
  group: Pick<CatalogGroup, 'options'>,
  settings: ReadonlyMap<string, BrandOptionSetting>,
): CatalogOption[] {
  return group.options.filter((o) => settingFor(settings, o.id).enabled);
}

/** Groups a product may still take: not attached yet, with at least one option the brand has. */
export function attachableGroups(
  groups: readonly CatalogGroup[],
  settings: ReadonlyMap<string, BrandOptionSetting>,
  attached: ReadonlySet<string>,
): CatalogGroup[] {
  return groups.filter((g) => !attached.has(g.id) && offeredOptions(g, settings).length > 0);
}

// ─── Bounds the API checks too ──────────────────────────────────────────────

/** An A group's bounds: whole numbers, `maxSelect ≥ 1`, `0 ≤ minSelect ≤ maxSelect`. */
export function isSelectRangeValid(min: number | null, max: number | null): boolean {
  const lo = min ?? 0;
  const hi = max ?? 1;
  return Number.isInteger(lo) && Number.isInteger(hi) && hi >= 1 && lo >= 0 && lo <= hi;
}

/** A C option's counter: `0 ≤ minQty ≤ defaultQty ≤ maxQty ≤ 20`, nulls read as 0 / 0 / 20. */
export function isQtyRangeValid(min: number | null, start: number | null, max: number | null): boolean {
  const lo = min ?? 0;
  const at = start ?? 0;
  const hi = max ?? OPTION_MAX_QTY_LIMIT;
  return [lo, at, hi].every(Number.isInteger) && lo >= 0 && lo <= at && at <= hi && hi <= OPTION_MAX_QTY_LIMIT;
}

// ─── The product editor's draft ─────────────────────────────────────────────

/** What the product editor holds while the groups are being changed. */
export interface ProductGroupsDraft {
  /** Attached groups, in the product's order. */
  groupIds: string[];
  /** VARIANT option → what it adds to the product's base price (absent = 0). */
  deltas: Record<string, number>;
  /** A/B option → the product's own default, kept only where it differs from the catalog's. */
  defaults: Record<string, boolean>;
}

export function draftFromConfig(config: ProductOptionGroupsConfig): ProductGroupsDraft {
  const deltas: Record<string, number> = {};
  const defaults: Record<string, boolean> = {};
  for (const o of config.overrides) {
    if (o.priceCents !== null && o.priceCents !== 0) deltas[o.optionId] = o.priceCents;
    if (o.isDefault !== null) defaults[o.optionId] = o.isDefault;
  }
  const groupIds = [...config.groups].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => g.groupId);
  return { groupIds, deltas, defaults };
}

/**
 * The attached groups as the customer is asked: variants first, then
 * add-ons, each kind in the product's order. A group missing from the
 * catalog (deleted meanwhile) is left out.
 */
export function attachedGroups(draft: ProductGroupsDraft, groups: readonly CatalogGroup[]): CatalogGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const list = draft.groupIds.map((id) => byId.get(id)).filter((g): g is CatalogGroup => g !== undefined);
  return [...groupsOfKind(list, 'VARIANT'), ...groupsOfKind(list, 'ADDON')];
}

/** Whether the option starts picked on this product: the product's own default, else the catalog's. */
export function effectiveDefault(draft: ProductGroupsDraft, option: Pick<CatalogOption, 'id' | 'isDefault'>): boolean {
  return draft.defaults[option.id] ?? option.isDefault;
}

/**
 * The draft with `option` made a default of this product (or not). In a
 * one-of A group the default moves there; a several-of A group refuses one
 * above its maximum; C has no defaults to pick (its starting count is the
 * catalog's).
 */
export function withDefault(
  draft: ProductGroupsDraft,
  group: CatalogGroup,
  optionId: string,
  on: boolean,
): ProductGroupsDraft {
  if (group.type === 'C') return draft;
  const defaults = { ...draft.defaults };
  const set = (option: CatalogOption, value: boolean) => {
    if (value === option.isDefault) delete defaults[option.id];
    else defaults[option.id] = value;
  };
  const option = group.options.find((o) => o.id === optionId);
  if (!option) return draft;
  if (on && group.type === 'A') {
    const max = Math.max(1, group.maxSelect ?? 1);
    if (max === 1) {
      for (const other of group.options) if (other.id !== optionId) set(other, false);
    } else {
      const picked = group.options.filter((o) => o.id !== optionId && effectiveDefault(draft, o)).length;
      if (picked >= max) return draft;
    }
  }
  set(option, on);
  return { ...draft, defaults };
}

/** The draft with a VARIANT option adding `delta` to the base price. */
export function withDelta(draft: ProductGroupsDraft, optionId: string, delta: number): ProductGroupsDraft {
  const deltas = { ...draft.deltas };
  if (delta === 0) delete deltas[optionId];
  else deltas[optionId] = delta;
  return { ...draft, deltas };
}

/** The draft with a group attached at the end of its kind. */
export function withGroup(draft: ProductGroupsDraft, groupId: string): ProductGroupsDraft {
  return draft.groupIds.includes(groupId) ? draft : { ...draft, groupIds: [...draft.groupIds, groupId] };
}

export function withoutGroup(draft: ProductGroupsDraft, groupId: string): ProductGroupsDraft {
  return { ...draft, groupIds: draft.groupIds.filter((id) => id !== groupId) };
}

/** The draft with a group moved one place within its kind (variants always come first). */
export function withGroupMoved(
  draft: ProductGroupsDraft,
  groups: readonly CatalogGroup[],
  groupId: string,
  delta: -1 | 1,
): ProductGroupsDraft {
  const ordered = attachedGroups(draft, groups);
  const group = ordered.find((g) => g.id === groupId);
  if (!group) return draft;
  const kind = groupsOfKind(ordered, group.kind);
  const index = kind.indexOf(group);
  const other = kind[index + delta];
  if (!other) return draft;
  kind[index] = other;
  kind[index + delta] = group;
  const variants = group.kind === 'VARIANT' ? kind : groupsOfKind(ordered, 'VARIANT');
  const addons = group.kind === 'ADDON' ? kind : groupsOfKind(ordered, 'ADDON');
  return { ...draft, groupIds: [...variants, ...addons].map((g) => g.id) };
}

/**
 * What `PUT /admin/products/:id/option-groups` takes: the attached groups
 * numbered in the order the customer is asked, and an override for each
 * option of those groups that has a value of its own — a variant's price,
 * a default other than the catalog's. Overrides of detached groups go.
 */
export function configFromDraft(draft: ProductGroupsDraft, groups: readonly CatalogGroup[]): ProductOptionGroupsConfig {
  const attached = attachedGroups(draft, groups);
  const overrides: ProductOptionOverride[] = [];
  for (const group of attached) {
    for (const option of group.options) {
      const delta = group.kind === 'VARIANT' ? (draft.deltas[option.id] ?? 0) : 0;
      const own = group.type === 'C' ? undefined : draft.defaults[option.id];
      const isDefault = own === undefined || own === option.isDefault ? null : own;
      const priceCents = delta === 0 ? null : delta;
      if (priceCents !== null || isDefault !== null) overrides.push({ optionId: option.id, priceCents, isDefault });
    }
  }
  overrides.sort((a, b) => (a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0));
  return { groups: attached.map((g, i) => ({ groupId: g.id, sortOrder: i })), overrides };
}

/** Two configs that save the same thing. */
export function sameConfig(a: ProductOptionGroupsConfig, b: ProductOptionGroupsConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
