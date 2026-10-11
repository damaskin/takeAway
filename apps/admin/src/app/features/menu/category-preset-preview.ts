import { type CategoryKind, optionPresetFor, type OptionPresetItem } from '@takeaway/shared-types';

import type {
  CategoryOptionDto,
  CategoryOptionInput,
  CategoryOptionKind,
  IngredientDto,
  VariationType,
} from '../../core/catalog/admin-catalog.service';
import { formatMoneyInput, parseMoney } from './menu-input';

/** One line of a preset preview: what the set would get, before the owner confirms. */
export interface PresetPreviewRow {
  key: string;
  groupKey: string;
  /** The preset group's name in the cabinet's language — the add-on group of a MODIFIER. */
  groupName: string;
  kind: CategoryOptionKind;
  variationType: VariationType | null;
  /** The library entry's name when one is reused, else the preset's. */
  name: string;
  /** The library entry reused for it, if the brand has one. */
  ingredientId: string | null;
  /** Already in the category's set: shown, never sent again. */
  inSet: boolean;
  include: boolean;
  isDefault: boolean;
  maxCount: number;
  /** Surcharge as typed, in the cabinet's money format. */
  price: string;
}

const norm = (text: string) => text.trim().toLocaleLowerCase();

function namesOf(item: OptionPresetItem): string[] {
  return [item.name.ru, item.name.en, ...(item.aliases ?? [])].map(norm);
}

/**
 * The preset of a kind as the preview lists it, in the cabinet's language.
 * An add-on or milk the brand library already has (by name or alias) is
 * reused with its name and usual price; one already in the category's set
 * is shown as such and left unticked.
 */
export function buildPresetPreview(
  kind: CategoryKind,
  lang: 'ru' | 'en',
  library: readonly IngredientDto[],
  set: readonly CategoryOptionDto[],
  separator: string,
): PresetPreviewRow[] {
  const rows: PresetPreviewRow[] = [];
  for (const group of optionPresetFor(kind)) {
    for (const item of group.items) {
      const names = namesOf(item);
      const variationType = group.kind === 'VARIATION' ? (group.variationType ?? null) : null;
      // Sizes, temperatures and cups are not stocked: never from the library.
      const stocked = group.kind === 'MODIFIER' || variationType === 'MILK';
      const entry = stocked ? library.find((i) => names.includes(norm(i.name))) : undefined;
      const inSet = set.some(
        (o) =>
          o.kind === group.kind &&
          o.variationType === variationType &&
          ((entry && o.ingredientId === entry.id) || names.includes(norm(o.name))),
      );
      rows.push({
        key: item.key,
        groupKey: group.key,
        groupName: group.name[lang],
        kind: group.kind,
        variationType,
        name: entry?.name ?? item.name[lang],
        ingredientId: entry?.id ?? null,
        inSet,
        include: !inSet,
        isDefault: item.isDefault ?? false,
        maxCount: item.maxCount ?? group.maxCount ?? 1,
        price: formatMoneyInput(entry ? entry.priceCents : item.priceCents, separator),
      });
    }
  }
  return rows;
}

/**
 * What the ticked rows send to the category's set, or `null` when a price
 * cannot be read. An empty price is free.
 */
export function presetPreviewOptions(rows: readonly PresetPreviewRow[]): CategoryOptionInput[] | null {
  const options: CategoryOptionInput[] = [];
  for (const row of rows) {
    if (!row.include || row.inSet) continue;
    const priceDeltaCents = row.price.trim() ? parseMoney(row.price) : 0;
    if (priceDeltaCents === null) return null;
    const source = row.ingredientId ? { ingredientId: row.ingredientId } : { name: row.name };
    options.push(
      row.kind === 'VARIATION'
        ? {
            kind: 'VARIATION',
            variationType: row.variationType ?? 'SIZE',
            ...source,
            priceDeltaCents,
            isDefault: row.isDefault,
          }
        : { kind: 'MODIFIER', ...source, priceDeltaCents, group: row.groupName, maxCount: row.maxCount },
    );
  }
  return options;
}

/** Choice groups first, in the order a customer meets them, then the add-on groups as the set lists them. */
const VARIATION_ORDER: readonly VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

export interface SetGroup<T> {
  key: string;
  /** `type:SIZE` groups are labelled by type, `group:Сиропы` by name, `group:` is «Добавки». */
  variationType: VariationType | null;
  group: string | null;
  items: T[];
}

export function groupOptions<
  T extends { kind: CategoryOptionKind; variationType: VariationType | null; group?: string | null },
>(options: readonly T[]): SetGroup<T>[] {
  const groups: SetGroup<T>[] = VARIATION_ORDER.map((type) => ({
    key: `type:${type}`,
    variationType: type,
    group: null,
    items: options.filter((o) => o.kind === 'VARIATION' && o.variationType === type),
  }));
  for (const option of options) {
    if (option.kind !== 'MODIFIER') continue;
    const name = option.group ?? null;
    const key = `group:${norm(name ?? '')}`;
    const found = groups.find((g) => g.key === key);
    if (found) found.items.push(option);
    else groups.push({ key, variationType: null, group: name, items: [option] });
  }
  return groups.filter((g) => g.items.length > 0);
}
