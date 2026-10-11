import type { Modifier, Variation } from '@takeaway/shared-types';

import {
  chosenModifiers,
  clampModifierCount,
  defaultVariationSelection,
  describeChoice,
  groupModifiers,
  groupVariations,
  hasRequiredOptions,
  initialModifierCounts,
  priceWithOptions,
} from './product-options';

function variation(over: Partial<Variation> & Pick<Variation, 'id' | 'type' | 'name'>): Variation {
  return { priceDeltaCents: 0, prepTimeDeltaSeconds: 0, sortOrder: 0, isDefault: false, ...over };
}

function modifier(over: Partial<Modifier> & Pick<Modifier, 'id' | 'name'>): Modifier {
  return {
    slug: over.id,
    priceDeltaCents: 0,
    prepTimeDeltaSeconds: 0,
    minCount: 0,
    maxCount: 1,
    sortOrder: 0,
    ...over,
  };
}

describe('product options', () => {
  // Listed out of page order on purpose: the helpers own the order.
  const variations = [
    variation({ id: 'oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 60, sortOrder: 1 }),
    variation({ id: 'cow', type: 'MILK', name: 'Обычное', sortOrder: 0 }),
    variation({ id: 'l', type: 'SIZE', name: 'L', priceDeltaCents: 140, sortOrder: 2 }),
    variation({ id: 'm', type: 'SIZE', name: 'M', sortOrder: 1, isDefault: true }),
    variation({ id: 's', type: 'SIZE', name: 'S', priceDeltaCents: -50, sortOrder: 0 }),
    variation({ id: 'iced', type: 'TEMPERATURE', name: 'Со льдом', sortOrder: 0 }),
  ];
  const modifiers = [
    modifier({ id: 'caramel', name: 'Карамель', group: 'Сиропы', priceDeltaCents: 50, maxCount: 3, sortOrder: 2 }),
    modifier({ id: 'shot', name: 'Шот эспрессо', priceDeltaCents: 80, sortOrder: 0 }),
    modifier({ id: 'vanilla', name: 'Ваниль', group: 'Сиропы', priceDeltaCents: 50, maxCount: 3, sortOrder: 1 }),
    modifier({ id: 'lid', name: 'Крышка', group: '  ', sortOrder: 3 }),
    modifier({ id: 'sugar', name: 'Без сахара', group: 'Убрать', sortOrder: 4, minCount: 1, maxCount: 1 }),
  ];
  const product = { basePriceCents: 2000, variations, modifiers };

  describe('groupVariations', () => {
    it('asks for the size first, then temperature and milk, each in the menu order', () => {
      const groups = groupVariations(variations);
      expect(groups.map((g) => g.type)).toEqual(['SIZE', 'TEMPERATURE', 'MILK']);
      expect(groups[0]?.variations.map((v) => v.id)).toEqual(['s', 'm', 'l']);
      expect(groups[2]?.variations.map((v) => v.id)).toEqual(['cow', 'oat']);
    });

    it('has nothing to ask for a product without options', () => {
      expect(groupVariations([])).toEqual([]);
    });
  });

  describe('defaultVariationSelection', () => {
    it("takes the business's default, else the first option of the type", () => {
      expect(defaultVariationSelection(variations)).toEqual({ SIZE: 'm', TEMPERATURE: 'iced', MILK: 'cow' });
    });
  });

  describe('groupModifiers', () => {
    it('groups add-ons under their headings in menu order, a blank heading joining the general one', () => {
      const groups = groupModifiers(modifiers);
      expect(groups.map((g) => g.name)).toEqual([null, 'Сиропы', 'Убрать']);
      expect(groups[0]?.modifiers.map((m) => m.id)).toEqual(['shot', 'lid']);
      expect(groups[1]?.modifiers.map((m) => m.id)).toEqual(['vanilla', 'caramel']);
    });

    it('marks a group required when one of its add-ons has a minimum', () => {
      expect(groupModifiers(modifiers).map((g) => g.required)).toEqual([false, false, true]);
    });

    it('reads add-ons from an API without groups as the general group', () => {
      const groups = groupModifiers([modifier({ id: 'a', name: 'A' }), modifier({ id: 'b', name: 'B', group: null })]);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.name).toBeNull();
    });
  });

  describe('counts and price', () => {
    it('starts every add-on at its minimum', () => {
      expect(initialModifierCounts(modifiers)).toEqual({ caramel: 0, shot: 0, vanilla: 0, lid: 0, sugar: 1 });
    });

    it('keeps a count inside the allowed range', () => {
      const syrup = { minCount: 0, maxCount: 3 };
      expect(clampModifierCount(syrup, 5)).toBe(3);
      expect(clampModifierCount(syrup, -1)).toBe(0);
      expect(clampModifierCount({ minCount: 1, maxCount: 1 }, 0)).toBe(1);
    });

    it('adds the picked options and each add-on times its count to the base price', () => {
      const selection = { SIZE: 'l', MILK: 'oat' };
      expect(priceWithOptions(product, selection, { vanilla: 2, shot: 1 })).toBe(2000 + 140 + 60 + 100 + 80);
    });

    it('takes a cheaper size off the price', () => {
      expect(priceWithOptions(product, { SIZE: 's' }, {})).toBe(1950);
    });

    it('lists only the add-ons taken', () => {
      expect(chosenModifiers(modifiers, { vanilla: 2, caramel: 0 }).map((c) => [c.modifier.id, c.count])).toEqual([
        ['vanilla', 2],
      ]);
    });
  });

  describe('describeChoice', () => {
    it('reads like an order line, in the order of the page', () => {
      const line = describeChoice(product, { MILK: 'oat', SIZE: 'l' }, { caramel: 1, vanilla: 2, shot: 1 });
      expect(line).toBe('L · Овсяное · +Шот эспрессо · +Ваниль ×2 · +Карамель');
    });

    it('is empty for a product without options', () => {
      expect(describeChoice({ variations: [], modifiers: [] }, {}, {})).toBe('');
    });
  });

  describe('hasRequiredOptions', () => {
    it('stops a quick add only for an add-on that must be taken', () => {
      expect(hasRequiredOptions(product)).toBe(true);
      expect(hasRequiredOptions({ modifiers: [{ minCount: 0 }] })).toBe(false);
      expect(hasRequiredOptions({ modifiers: [] })).toBe(false);
    });
  });
});
