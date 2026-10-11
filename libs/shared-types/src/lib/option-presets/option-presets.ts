import type { CategoryKind, VariationType } from '../catalog';

/**
 * Ready-made option sets per category kind — the platform's starting point
 * for a category's options («Добавить набор для горячих напитков»). The
 * admin previews one, the business unticks what it does not sell and types
 * its prices, and the result becomes the category's option set; nothing
 * here is read at order time. See README.md next to this file.
 */

/** A name in both languages of the cabinet. */
export interface OptionPresetName {
  ru: string;
  en: string;
}

/** What a group becomes on a product. */
export type OptionPresetGroupKind = 'VARIATION' | 'MODIFIER';

export interface OptionPresetItem {
  /**
   * Stable id, e.g. `milk.oat`: unique within one kind, and the same item
   * keeps its key in every kind that offers it. The admin tracks ticks by it.
   */
  key: string;
  name: OptionPresetName;
  /**
   * Other names a brand's add-ons library may already use for it, lower
   * case («ванильный сироп» for «Ваниль»): an entry with one of them is
   * reused instead of a second «Ваниль» being created.
   */
  aliases?: readonly string[];
  /**
   * Suggested surcharge in the brand's minor units. Brands sell in
   * different currencies, so most are 0 — the business types its own price
   * in the preview; an add-on already in its library keeps its price there.
   */
  priceCents: number;
  /** VARIATION groups: the choice pre-selected on the product screen. */
  isDefault?: boolean;
  /** MODIFIER groups: how many of it one item may take; overrides the group's. */
  maxCount?: number;
}

export interface OptionPresetGroup {
  key: string;
  /**
   * VARIATION — the customer picks exactly one (`variationType` says which
   * group: size, milk…). MODIFIER — add-ons shown under `name` as their
   * group label (`Modifier.group`), each optional.
   */
  kind: OptionPresetGroupKind;
  variationType?: VariationType;
  name: OptionPresetName;
  /** MODIFIER groups: how many of one add-on an item may take (1 when omitted). */
  maxCount?: number;
  items: readonly OptionPresetItem[];
}

const SIZE: OptionPresetGroup = {
  key: 'size',
  kind: 'VARIATION',
  variationType: 'SIZE',
  name: { ru: 'Размер', en: 'Size' },
  items: [
    { key: 'size.small', name: { ru: 'Маленький', en: 'Small' }, priceCents: 0, isDefault: true },
    { key: 'size.medium', name: { ru: 'Средний', en: 'Medium' }, priceCents: 0 },
    { key: 'size.large', name: { ru: 'Большой', en: 'Large' }, priceCents: 0 },
  ],
};

const MILK: OptionPresetGroup = {
  key: 'milk',
  kind: 'VARIATION',
  variationType: 'MILK',
  name: { ru: 'Молоко', en: 'Milk' },
  items: [
    {
      key: 'milk.regular',
      name: { ru: 'Обычное молоко', en: 'Regular milk' },
      aliases: ['обычное', 'коровье молоко', 'regular', 'whole milk', 'milk'],
      priceCents: 0,
      isDefault: true,
    },
    {
      key: 'milk.oat',
      name: { ru: 'Овсяное молоко', en: 'Oat milk' },
      aliases: ['овсяное', 'oat'],
      priceCents: 0,
    },
    {
      key: 'milk.almond',
      name: { ru: 'Миндальное молоко', en: 'Almond milk' },
      aliases: ['миндальное', 'almond'],
      priceCents: 0,
    },
    {
      key: 'milk.coconut',
      name: { ru: 'Кокосовое молоко', en: 'Coconut milk' },
      aliases: ['кокосовое', 'coconut'],
      priceCents: 0,
    },
    {
      key: 'milk.lactose-free',
      name: { ru: 'Безлактозное молоко', en: 'Lactose-free milk' },
      aliases: ['безлактозное', 'lactose-free', 'lactose free milk'],
      priceCents: 0,
    },
  ],
};

const SYRUPS: OptionPresetGroup = {
  key: 'syrups',
  kind: 'MODIFIER',
  name: { ru: 'Сиропы', en: 'Syrups' },
  maxCount: 2,
  items: [
    {
      key: 'syrup.vanilla',
      name: { ru: 'Ваниль', en: 'Vanilla' },
      aliases: ['ванильный сироп', 'сироп ваниль', 'сироп ванильный', 'vanilla syrup'],
      priceCents: 0,
    },
    {
      key: 'syrup.caramel',
      name: { ru: 'Карамель', en: 'Caramel' },
      aliases: ['карамельный сироп', 'сироп карамель', 'caramel syrup'],
      priceCents: 0,
    },
    {
      key: 'syrup.hazelnut',
      name: { ru: 'Лесной орех', en: 'Hazelnut' },
      aliases: ['ореховый сироп', 'сироп лесной орех', 'hazelnut syrup'],
      priceCents: 0,
    },
    {
      key: 'syrup.coconut',
      name: { ru: 'Кокос', en: 'Coconut' },
      aliases: ['кокосовый сироп', 'сироп кокос', 'coconut syrup'],
      priceCents: 0,
    },
    {
      key: 'syrup.salted-caramel',
      name: { ru: 'Солёная карамель', en: 'Salted caramel' },
      aliases: ['соленая карамель', 'сироп солёная карамель', 'сироп соленая карамель', 'salted caramel syrup'],
      priceCents: 0,
    },
  ],
};

const EXTRA_SHOT: OptionPresetItem = {
  key: 'extra.shot',
  name: { ru: 'Доп. шот эспрессо', en: 'Extra espresso shot' },
  aliases: ['доп. шот', 'дополнительный шот', 'шот эспрессо', 'extra shot'],
  priceCents: 0,
  maxCount: 3,
};

export const OPTION_PRESETS: Readonly<Record<CategoryKind, readonly OptionPresetGroup[]>> = {
  HOT_DRINKS: [
    SIZE,
    MILK,
    SYRUPS,
    {
      key: 'hot.extras',
      kind: 'MODIFIER',
      name: { ru: 'Дополнительно', en: 'Extras' },
      items: [
        EXTRA_SHOT,
        { key: 'extra.cream', name: { ru: 'Сливки', en: 'Cream' }, aliases: ['cream'], priceCents: 0 },
        { key: 'extra.cinnamon', name: { ru: 'Корица', en: 'Cinnamon' }, priceCents: 0 },
        { key: 'extra.marshmallow', name: { ru: 'Маршмеллоу', en: 'Marshmallows' }, priceCents: 0 },
      ],
    },
  ],
  COLD_DRINKS: [
    SIZE,
    MILK,
    SYRUPS,
    {
      key: 'cold.ice',
      kind: 'MODIFIER',
      name: { ru: 'Лёд', en: 'Ice' },
      items: [
        { key: 'ice.none', name: { ru: 'Без льда', en: 'No ice' }, priceCents: 0 },
        { key: 'ice.less', name: { ru: 'Меньше льда', en: 'Less ice' }, priceCents: 0 },
      ],
    },
    {
      key: 'cold.extras',
      kind: 'MODIFIER',
      name: { ru: 'Дополнительно', en: 'Extras' },
      items: [
        EXTRA_SHOT,
        {
          key: 'extra.whipped-cream',
          name: { ru: 'Взбитые сливки', en: 'Whipped cream' },
          priceCents: 0,
        },
        {
          key: 'extra.ice-cream',
          name: { ru: 'Шарик мороженого', en: 'Scoop of ice cream' },
          priceCents: 0,
        },
      ],
    },
  ],
  FOOD: [
    {
      key: 'food.sauces',
      kind: 'MODIFIER',
      name: { ru: 'Соусы', en: 'Sauces' },
      items: [
        {
          key: 'sauce.garlic',
          name: { ru: 'Чесночный соус', en: 'Garlic sauce' },
          aliases: ['чесночный'],
          priceCents: 0,
        },
        { key: 'sauce.hot', name: { ru: 'Острый соус', en: 'Hot sauce' }, aliases: ['острый'], priceCents: 0 },
        { key: 'sauce.cheese', name: { ru: 'Сырный соус', en: 'Cheese sauce' }, aliases: ['сырный'], priceCents: 0 },
        { key: 'sauce.bbq', name: { ru: 'Соус барбекю', en: 'BBQ sauce' }, aliases: ['барбекю'], priceCents: 0 },
        { key: 'sauce.ketchup', name: { ru: 'Кетчуп', en: 'Ketchup' }, priceCents: 0 },
      ],
    },
    {
      key: 'food.add',
      kind: 'MODIFIER',
      name: { ru: 'Добавить', en: 'Add' },
      items: [
        { key: 'add.cheese', name: { ru: 'Сыр', en: 'Cheese' }, priceCents: 0 },
        { key: 'add.jalapeno', name: { ru: 'Халапеньо', en: 'Jalapeño' }, priceCents: 0 },
        { key: 'add.bacon', name: { ru: 'Бекон', en: 'Bacon' }, priceCents: 0 },
        {
          key: 'add.double-meat',
          name: { ru: 'Двойная порция мяса', en: 'Double meat' },
          priceCents: 0,
        },
      ],
    },
    {
      key: 'food.remove',
      kind: 'MODIFIER',
      name: { ru: 'Убрать', en: 'Remove' },
      items: [
        { key: 'remove.onion', name: { ru: 'Без лука', en: 'No onion' }, priceCents: 0 },
        { key: 'remove.tomato', name: { ru: 'Без помидоров', en: 'No tomatoes' }, priceCents: 0 },
        { key: 'remove.sauce', name: { ru: 'Без соуса', en: 'No sauce' }, priceCents: 0 },
      ],
    },
  ],
  BAKERY: [
    {
      key: 'bakery.serving',
      kind: 'MODIFIER',
      name: { ru: 'Подача', en: 'Serving' },
      items: [{ key: 'serving.warm', name: { ru: 'Подогреть', en: 'Warm up' }, priceCents: 0 }],
    },
    {
      key: 'bakery.add',
      kind: 'MODIFIER',
      name: { ru: 'Добавить', en: 'Add' },
      items: [
        { key: 'add.jam', name: { ru: 'Джем', en: 'Jam' }, priceCents: 0 },
        {
          key: 'add.condensed-milk',
          name: { ru: 'Сгущёнка', en: 'Condensed milk' },
          aliases: ['сгущенка', 'сгущённое молоко', 'сгущенное молоко'],
          priceCents: 0,
        },
        { key: 'add.chocolate', name: { ru: 'Шоколад', en: 'Chocolate' }, priceCents: 0 },
      ],
    },
  ],
  OTHER: [],
};

/** The set offered for a kind; OTHER has none of its own. */
export function optionPresetFor(kind: CategoryKind): readonly OptionPresetGroup[] {
  return OPTION_PRESETS[kind];
}
