import type { OptionGroupKind, OptionGroupType, ProductOptionGroup, ProductOptionItem } from '@takeaway/shared-types';

/** A catalog option as the API sends it for a store, with test defaults. */
export function catalogOption(id: string, name: string, over: Partial<ProductOptionItem> = {}): ProductOptionItem {
  return {
    id,
    name,
    note: null,
    isDefault: false,
    minQty: null,
    maxQty: null,
    defaultQty: null,
    priceCents: 0,
    available: true,
    sortOrder: 0,
    ...over,
  };
}

/** A catalog group attached to a product; an A group defaults to one of, optional. */
export function catalogGroup(
  id: string,
  kind: OptionGroupKind,
  type: OptionGroupType,
  name: string,
  options: ProductOptionItem[],
  over: Partial<ProductOptionGroup> = {},
): ProductOptionGroup {
  return {
    id,
    kind,
    type,
    name,
    minSelect: type === 'A' ? 0 : null,
    maxSelect: type === 'A' ? 1 : null,
    showIfOptionId: null,
    options,
    ...over,
  };
}

/**
 * A coffee's groups, variants first, after the spec's seed: a size to pick
 * (no default), hot unless iced, decaf on a switch, cow's milk (coconut has
 * run out), up to two syrups, one topping at most, extras on switches, and
 * ice for an iced one only.
 */
export const COFFEE_GROUPS: ProductOptionGroup[] = [
  catalogGroup(
    'size',
    'VARIANT',
    'A',
    'Размер (кофе)',
    [
      catalogOption('s', 'S', { note: '150–250 мл', priceCents: -500 }),
      catalogOption('m', 'M', { note: '300–350 мл' }),
      catalogOption('l', 'L', { note: '400–450 мл', priceCents: 700 }),
    ],
    { minSelect: 1 },
  ),
  catalogGroup(
    'serving',
    'VARIANT',
    'A',
    'Подача',
    [catalogOption('hot', 'Горячий', { isDefault: true }), catalogOption('iced', 'Холодный')],
    { minSelect: 1 },
  ),
  catalogGroup('decaf', 'VARIANT', 'B', 'Без кофеина', [catalogOption('decaf-on', 'Без кофеина')]),
  catalogGroup(
    'milk',
    'ADDON',
    'A',
    'Молоко',
    [
      catalogOption('cow', 'Коровье', { isDefault: true }),
      catalogOption('oat', 'Овсяное', { priceCents: 1000 }),
      catalogOption('coconut', 'Кокосовое', { priceCents: 1000, available: false }),
    ],
    { minSelect: 1 },
  ),
  catalogGroup(
    'syrups',
    'ADDON',
    'A',
    'Сиропы',
    [
      catalogOption('vanilla', 'Ваниль', { priceCents: 800 }),
      catalogOption('caramel', 'Карамель', { priceCents: 800 }),
      catalogOption('salted', 'Солёная карамель', { priceCents: 800 }),
    ],
    { maxSelect: 2 },
  ),
  catalogGroup('topping', 'ADDON', 'A', 'Топинг-соус', [
    catalogOption('caramel-sauce', 'Карамельный', { priceCents: 500 }),
    catalogOption('choc-sauce', 'Шоколадный', { priceCents: 500 }),
  ]),
  catalogGroup('extras', 'ADDON', 'B', 'Добавки к кофе', [
    catalogOption('cinnamon', 'Корица', { priceCents: 300 }),
    catalogOption('honey', 'Мёд'),
  ]),
  catalogGroup('ice', 'ADDON', 'C', 'Лёд', [catalogOption('ice-qty', 'Лёд', { minQty: 0, maxQty: 3, defaultQty: 0 })], {
    showIfOptionId: 'iced',
  }),
];

/** «Мясо (порции)»: one portion in the price, a second one paid. */
export const MEAT_PORTIONS: ProductOptionGroup = catalogGroup('portions', 'ADDON', 'C', 'Мясо (порции)', [
  catalogOption('meat', 'Мясо / котлета', { minQty: 1, maxQty: 2, defaultQty: 1, priceCents: 1500 }),
]);
