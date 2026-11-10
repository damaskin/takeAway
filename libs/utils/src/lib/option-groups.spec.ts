import type { ProductOptionGroup, ProductOptionItem } from '@takeaway/shared-types';

import {
  defaultOptionPicks,
  describeOptionLines,
  fromOptionSelections,
  isGroupVisible,
  needsOptionChoice,
  normalizeOptionPicks,
  optionLinesFor,
  optionSelectionKey,
  orderOptionGroups,
  priceWithOptionPicks,
  setOptionQty,
  toggleOptionPick,
  toOptionSelections,
  validateOptionPicks,
} from './option-groups';
import { describeOrderItemOptions, readOrderItemSnapshot } from './order-item';

function option(id: string, over: Partial<ProductOptionItem> = {}): ProductOptionItem {
  return {
    id,
    name: id,
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

function group(over: Partial<ProductOptionGroup> & Pick<ProductOptionGroup, 'id' | 'options'>): ProductOptionGroup {
  return { kind: 'ADDON', type: 'A', name: over.id, minSelect: null, maxSelect: null, showIfOptionId: null, ...over };
}

// The cappuccino of the spec's example (§6), priced per the spec: M is the
// base (4500), oat +1000, syrups +800 each, sugar free.
const size = group({
  id: 'size',
  name: 'Размер (кофе)',
  kind: 'VARIANT',
  minSelect: 1,
  maxSelect: 1,
  options: [
    option('S', { name: 'S', note: '150–250 мл', priceCents: -500 }),
    option('M', { name: 'M', note: '300–350 мл' }),
    option('L', { name: 'L', note: '400–450 мл', priceCents: 700 }),
  ],
});
const serving = group({
  id: 'serving',
  name: 'Подача',
  kind: 'VARIANT',
  minSelect: 1,
  maxSelect: 1,
  options: [option('hot', { name: 'Горячий', isDefault: true }), option('iced', { name: 'Холодный' })],
});
const milk = group({
  id: 'milk',
  name: 'Молоко',
  minSelect: 1,
  maxSelect: 1,
  options: [
    option('cow', { name: 'Коровье', isDefault: true }),
    option('oat', { name: 'Овсяное', priceCents: 1000 }),
    option('coconut', { name: 'Кокосовое', priceCents: 1000, available: false }),
  ],
});
const syrups = group({
  id: 'syrups',
  name: 'Сиропы',
  minSelect: 0,
  maxSelect: 2,
  options: [
    option('vanilla', { name: 'Ваниль', priceCents: 800 }),
    option('salted', { name: 'Солёная карамель', priceCents: 800 }),
    option('hazelnut', { name: 'Лесной орех', priceCents: 800 }),
  ],
});
const foam = group({
  id: 'foam',
  name: 'Пенка-топ',
  minSelect: 0,
  maxSelect: 1,
  showIfOptionId: 'iced',
  options: [option('cream-foam', { name: 'Сливочная', priceCents: 900 })],
});
const extras = group({
  id: 'extras',
  name: 'Добавки к кофе',
  type: 'B',
  options: [option('cinnamon', { name: 'Корица', priceCents: 200 }), option('honey', { name: 'Мёд', priceCents: 300 })],
});
const sugar = group({
  id: 'sugar',
  name: 'Сахар',
  type: 'C',
  options: [option('sugar1', { name: 'Сахар', minQty: 0, maxQty: 3, defaultQty: 0 })],
});
const ice = group({
  id: 'ice',
  name: 'Лёд',
  type: 'C',
  showIfOptionId: 'iced',
  options: [option('ice1', { name: 'Лёд', minQty: 0, maxQty: 3, defaultQty: 0, priceCents: 100 })],
});
const coffee = [size, serving, milk, syrups, foam, extras, sugar, ice];

const meatKind = group({
  id: 'meat-kind',
  name: 'Мясо',
  kind: 'VARIANT',
  minSelect: 1,
  maxSelect: 1,
  options: [
    option('chicken', { name: 'Курица', isDefault: true }),
    option('beef', { name: 'Говядина', priceCents: 1500 }),
  ],
});
const meatPortions = group({
  id: 'meat',
  name: 'Мясо (порции)',
  type: 'C',
  options: [option('meat1', { name: 'Мясо / котлета', minQty: 1, maxQty: 2, defaultQty: 1, priceCents: 2500 })],
});
const shawarma = [meatKind, meatPortions];

describe('option groups', () => {
  describe('defaultOptionPicks', () => {
    it('picks the defaults and leaves a variant without one for the customer', () => {
      expect(defaultOptionPicks(coffee)).toEqual({ hot: 1, cow: 1 });
    });

    it('starts a C option at its default amount', () => {
      expect(defaultOptionPicks(shawarma)).toEqual({ chicken: 1, meat1: 1 });
    });

    it('skips a default the store has run out of', () => {
      const out = group({ ...milk, options: milk.options.map((o) => ({ ...o, available: o.id !== 'cow' })) });
      expect(defaultOptionPicks([out])).toEqual({});
    });
  });

  describe('a required variant', () => {
    it('keeps the product out of the cart until it is picked', () => {
      const picks = defaultOptionPicks(coffee);
      expect(validateOptionPicks(coffee, picks)).toEqual([{ code: 'TOO_FEW', groupId: 'size', optionId: null }]);
      expect(needsOptionChoice(coffee)).toBe(true);
      expect(validateOptionPicks(coffee, toggleOptionPick(coffee, picks, 'M'))).toEqual([]);
    });

    it('lets a product whose defaults are a full choice go in with one tap', () => {
      expect(needsOptionChoice(shawarma)).toBe(false);
      expect(needsOptionChoice([])).toBe(false);
    });

    it('cannot be unpicked, only moved', () => {
      const picks = toggleOptionPick(coffee, defaultOptionPicks(coffee), 'M');
      expect(toggleOptionPick(coffee, picks, 'M')).toEqual(picks);
      expect(toggleOptionPick(coffee, picks, 'L')).toEqual({ hot: 1, cow: 1, L: 1 });
    });
  });

  describe('type A with a maximum of 2', () => {
    it('does not take a third syrup', () => {
      let picks = toggleOptionPick(coffee, { M: 1, hot: 1, cow: 1 }, 'vanilla');
      picks = toggleOptionPick(coffee, picks, 'salted');
      expect(toggleOptionPick(coffee, picks, 'hazelnut')).toEqual(picks);
      expect(validateOptionPicks(coffee, { ...picks, hazelnut: 1 })).toEqual([
        { code: 'TOO_MANY', groupId: 'syrups', optionId: null },
      ]);
    });

    it('lets a syrup be taken off again', () => {
      const picks = toggleOptionPick(coffee, { M: 1, hot: 1, cow: 1 }, 'vanilla');
      expect(toggleOptionPick(coffee, picks, 'vanilla')).toEqual({ M: 1, hot: 1, cow: 1 });
    });
  });

  describe('type B', () => {
    it('switches every option on and off on its own', () => {
      let picks = toggleOptionPick(coffee, { M: 1, hot: 1, cow: 1 }, 'cinnamon');
      picks = toggleOptionPick(coffee, picks, 'honey');
      expect(picks).toEqual({ M: 1, hot: 1, cow: 1, cinnamon: 1, honey: 1 });
      expect(toggleOptionPick(coffee, picks, 'cinnamon')).toEqual({ M: 1, hot: 1, cow: 1, honey: 1 });
    });

    it('takes no more than one of an option', () => {
      expect(validateOptionPicks(coffee, { M: 1, hot: 1, cow: 1, honey: 2 })).toEqual([
        { code: 'BAD_QTY', groupId: 'extras', optionId: 'honey' },
      ]);
    });
  });

  describe('type C', () => {
    it('keeps the counter within its bounds, and 0 leaves the option out', () => {
      const base = { M: 1, hot: 1, cow: 1 };
      expect(setOptionQty(coffee, base, 'sugar1', 5)).toEqual({ ...base, sugar1: 3 });
      expect(setOptionQty(coffee, base, 'sugar1', -1)).toEqual(base);
      expect(optionLinesFor(coffee, setOptionQty(coffee, { ...base, sugar1: 2 }, 'sugar1', 0))).not.toContainEqual(
        expect.objectContaining({ optionId: 'sugar1' }),
      );
      expect(validateOptionPicks(coffee, { ...base, sugar1: 4 })).toEqual([
        { code: 'TOO_MANY', groupId: 'sugar', optionId: 'sugar1' },
      ]);
    });

    it('meat: not below 1, the first portion is in the price, the second costs one portion', () => {
      const picks = defaultOptionPicks(shawarma);
      expect(setOptionQty(shawarma, picks, 'meat1', 0)).toEqual(picks);
      expect(priceWithOptionPicks(15000, shawarma, picks)).toBe(15000);
      expect(priceWithOptionPicks(15000, shawarma, setOptionQty(shawarma, picks, 'meat1', 2))).toBe(17500);
      expect(validateOptionPicks(shawarma, { chicken: 1 })).toEqual([
        { code: 'TOO_FEW', groupId: 'meat', optionId: 'meat1' },
      ]);
    });

    it('charges every unit of an option the dish does not include', () => {
      const picks = { M: 1, iced: 1, cow: 1, ice1: 3 };
      expect(priceWithOptionPicks(4500, coffee, picks)).toBe(4800);
    });
  });

  describe('conditions (show_if)', () => {
    it('shows ice and foam only for an iced coffee', () => {
      const hot = { M: 1, hot: 1, cow: 1 };
      expect(isGroupVisible(ice, coffee, hot)).toBe(false);
      expect(isGroupVisible(foam, coffee, hot)).toBe(false);
      const iced = toggleOptionPick(coffee, hot, 'iced');
      expect(isGroupVisible(ice, coffee, iced)).toBe(true);
      expect(isGroupVisible(foam, coffee, iced)).toBe(true);
    });

    it('drops their picks when the coffee goes back to hot', () => {
      let picks = toggleOptionPick(coffee, { M: 1, hot: 1, cow: 1 }, 'iced');
      picks = setOptionQty(coffee, picks, 'ice1', 2);
      picks = toggleOptionPick(coffee, picks, 'cream-foam');
      expect(toggleOptionPick(coffee, picks, 'hot')).toEqual({ M: 1, hot: 1, cow: 1 });
    });

    it('refuses a pick in a hidden group', () => {
      expect(validateOptionPicks(coffee, { M: 1, hot: 1, cow: 1, ice1: 1 })).toEqual([
        { code: 'HIDDEN_GROUP', groupId: 'ice', optionId: 'ice1' },
      ]);
    });

    it('always shows the group when the condition is not on the product (ice for a cola)', () => {
      const drinkSize = group({
        id: 'drink',
        kind: 'VARIANT',
        maxSelect: 1,
        options: [option('03', { isDefault: true })],
      });
      const cola = [drinkSize, ice];
      expect(isGroupVisible(ice, cola, {})).toBe(true);
      expect(validateOptionPicks(cola, { '03': 1, ice1: 2 })).toEqual([]);
    });

    it('shows nothing for a loop of conditions', () => {
      const a = group({ id: 'a', showIfOptionId: 'b1', options: [option('a1')] });
      const b = group({ id: 'b', showIfOptionId: 'a1', options: [option('b1')] });
      expect(isGroupVisible(a, [a, b], { a1: 1, b1: 1 })).toBe(false);
    });

    it('settles a chain of conditions in one go', () => {
      const a = group({ id: 'a', type: 'B', options: [option('a1')] });
      const b = group({ id: 'b', type: 'B', showIfOptionId: 'a1', options: [option('b1')] });
      const c = group({ id: 'c', type: 'B', showIfOptionId: 'b1', options: [option('c1')] });
      expect(normalizeOptionPicks([a, b, c], { b1: 1, c1: 1 })).toEqual({});
    });
  });

  describe('stop list', () => {
    it('cannot pick an option the store has run out of', () => {
      const picks = { M: 1, hot: 1, cow: 1 };
      expect(toggleOptionPick(coffee, picks, 'coconut')).toEqual(picks);
      expect(validateOptionPicks(coffee, { M: 1, hot: 1, coconut: 1 })).toEqual([
        { code: 'OPTION_UNAVAILABLE', groupId: 'milk', optionId: 'coconut' },
      ]);
    });

    it('cannot make a dish whose required portion has run out', () => {
      const portion = option('meat1', {
        name: 'Мясо / котлета',
        minQty: 1,
        maxQty: 2,
        defaultQty: 1,
        available: false,
      });
      const out = [meatKind, group({ ...meatPortions, options: [portion] })];
      expect(defaultOptionPicks(out)).toEqual({ chicken: 1 });
      expect(validateOptionPicks(out, { chicken: 1 })).toEqual([
        { code: 'OPTION_UNAVAILABLE', groupId: 'meat', optionId: 'meat1' },
      ]);
    });

    it('does not know an option the product does not offer', () => {
      expect(validateOptionPicks(coffee, { M: 1, hot: 1, cow: 1, nope: 1 })).toEqual([
        { code: 'UNKNOWN_OPTION', groupId: null, optionId: 'nope' },
      ]);
      expect(validateOptionPicks(coffee, { M: 1.5 })).toEqual([{ code: 'BAD_QTY', groupId: 'size', optionId: 'M' }]);
    });
  });

  describe('price and lines', () => {
    const example = { M: 1, hot: 1, oat: 1, vanilla: 1, salted: 1, sugar1: 2 };

    it('prices the spec example at 71', () => {
      expect(validateOptionPicks(coffee, example)).toEqual([]);
      expect(priceWithOptionPicks(4500, coffee, example)).toBe(7100);
    });

    it('takes a variant price off or onto the base price', () => {
      expect(priceWithOptionPicks(4500, coffee, { S: 1, hot: 1, cow: 1 })).toBe(4000);
      expect(priceWithOptionPicks(4500, coffee, { L: 1, hot: 1, cow: 1 })).toBe(5200);
    });

    it('lists the picks variants first, in page order, with prices', () => {
      expect(optionLinesFor(coffee, example)).toEqual([
        expect.objectContaining({ optionId: 'M', kind: 'VARIANT', totalCents: 0 }),
        expect.objectContaining({ optionId: 'hot', kind: 'VARIANT', totalCents: 0 }),
        expect.objectContaining({ optionId: 'oat', groupName: 'Молоко', totalCents: 1000 }),
        expect.objectContaining({ optionId: 'vanilla', totalCents: 800 }),
        expect.objectContaining({ optionId: 'salted', totalCents: 800 }),
        expect.objectContaining({ optionId: 'sugar1', qty: 2, freeQty: 0, totalCents: 0 }),
      ]);
    });

    it('describes the line as the kitchen reads it', () => {
      expect(describeOptionLines(optionLinesFor(coffee, example))).toBe(
        'M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2',
      );
    });

    it('does not mention the meat portion the dish includes, only a double one', () => {
      expect(describeOptionLines(optionLinesFor(shawarma, { beef: 1, meat1: 1 }))).toBe('Говядина');
      expect(describeOptionLines(optionLinesFor(shawarma, { beef: 1, meat1: 2 }))).toBe('Говядина · Мясо / котлета ×2');
    });

    it('puts variants before add-ons whatever order the groups come in', () => {
      expect(orderOptionGroups([milk, size, sugar, serving]).map((g) => g.id)).toEqual([
        'size',
        'serving',
        'milk',
        'sugar',
      ]);
    });
  });

  describe('selections', () => {
    it('round-trips the API form in a stable order', () => {
      expect(toOptionSelections({ oat: 1, M: 1, sugar1: 0 })).toEqual([
        { optionId: 'M', qty: 1 },
        { optionId: 'oat', qty: 1 },
      ]);
      expect(
        fromOptionSelections([
          { optionId: 'ice1', qty: 1 },
          { optionId: 'ice1', qty: 1 },
        ]),
      ).toEqual({ ice1: 2 });
    });

    it('gives the same choice the same cart key in any order, and a different one another', () => {
      const a = optionSelectionKey([
        { optionId: 'oat', qty: 1 },
        { optionId: 'M', qty: 1 },
      ]);
      const b = optionSelectionKey([
        { optionId: 'M', qty: 1 },
        { optionId: 'oat', qty: 1 },
      ]);
      const c = optionSelectionKey([
        { optionId: 'M', qty: 1 },
        { optionId: 'cow', qty: 1 },
      ]);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });
  });

  describe('order snapshots', () => {
    it('reads option lines back and describes them with the older options', () => {
      const snapshot = readOrderItemSnapshot({
        id: 'p',
        name: 'Капучино',
        optionLines: [...optionLinesFor(coffee, example()), { name: 'broken' }],
      });
      expect(snapshot.optionLines).toHaveLength(3);
      expect(describeOrderItemOptions(snapshot)).toBe('M, Горячий · Овсяное');
    });

    it('reads an order placed before the catalog with no option lines', () => {
      expect(readOrderItemSnapshot({ id: 'p', name: 'Латте' }).optionLines).toEqual([]);
      expect(
        describeOrderItemOptions({
          variations: [{ id: 'v', type: 'SIZE', name: 'L', priceDeltaCents: 0 }],
          modifierLines: [],
        }),
      ).toBe('L');
    });

    function example(): Record<string, number> {
      return { M: 1, hot: 1, oat: 1 };
    }
  });
});
