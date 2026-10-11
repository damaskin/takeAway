import { CATEGORY_KINDS, MODIFIER_GROUP_MAX_LENGTH } from '../catalog';
import { OPTION_PRESETS, optionPresetFor } from './option-presets';

describe('OPTION_PRESETS', () => {
  const kinds = CATEGORY_KINDS.filter((kind) => kind !== 'OTHER');

  it('offers a set for every kind but OTHER', () => {
    for (const kind of kinds) expect(optionPresetFor(kind).length).toBeGreaterThan(0);
    expect(OPTION_PRESETS.OTHER).toEqual([]);
  });

  it('keeps item keys unique within a kind, and one key one item everywhere', () => {
    const byKey = new Map<string, string>();
    for (const kind of kinds) {
      const keys = optionPresetFor(kind).flatMap((g) => g.items.map((i) => i.key));
      expect(new Set(keys).size).toBe(keys.length);
      for (const group of optionPresetFor(kind)) {
        for (const item of group.items) {
          const seen = byKey.get(item.key);
          if (seen) expect(item.name.ru).toBe(seen);
          byKey.set(item.key, item.name.ru);
        }
      }
    }
  });

  it('names every group and item in Russian and English', () => {
    for (const kind of kinds) {
      for (const group of optionPresetFor(kind)) {
        expect(group.name.ru.trim()).not.toBe('');
        expect(group.name.en.trim()).not.toBe('');
        for (const item of group.items) {
          expect(item.name.ru.trim()).not.toBe('');
          expect(item.name.en.trim()).not.toBe('');
          expect(item.name.ru.length).toBeLessThanOrEqual(60);
        }
      }
    }
  });

  it('gives variation groups a type and at most one default, add-on groups a short label', () => {
    for (const kind of kinds) {
      for (const group of optionPresetFor(kind)) {
        if (group.kind === 'VARIATION') {
          expect(group.variationType).toBeDefined();
          expect(group.items.filter((i) => i.isDefault).length).toBeLessThanOrEqual(1);
        } else {
          expect(group.variationType).toBeUndefined();
          expect(group.name.ru.length).toBeLessThanOrEqual(MODIFIER_GROUP_MAX_LENGTH);
          expect(group.name.en.length).toBeLessThanOrEqual(MODIFIER_GROUP_MAX_LENGTH);
          expect(group.items.some((i) => i.isDefault)).toBe(false);
        }
      }
    }
  });

  it('suggests prices as whole minor units, never below zero, and lower-case aliases', () => {
    for (const kind of kinds) {
      for (const item of optionPresetFor(kind).flatMap((g) => g.items)) {
        expect(Number.isInteger(item.priceCents) && item.priceCents >= 0).toBe(true);
        for (const alias of item.aliases ?? []) expect(alias).toBe(alias.toLowerCase());
      }
    }
  });

  it('lists the sets the manager asked for', () => {
    const groups = (kind: (typeof kinds)[number]) => optionPresetFor(kind).map((g) => g.name.ru);
    expect(groups('HOT_DRINKS')).toEqual(['Размер', 'Молоко', 'Сиропы', 'Дополнительно']);
    expect(groups('COLD_DRINKS')).toEqual(['Размер', 'Молоко', 'Сиропы', 'Лёд', 'Дополнительно']);
    expect(groups('FOOD')).toEqual(['Соусы', 'Добавить', 'Убрать']);
    expect(groups('BAKERY')).toEqual(['Подача', 'Добавить']);
    const remove = optionPresetFor('FOOD').find((g) => g.key === 'food.remove');
    expect(remove?.items.every((i) => i.priceCents === 0)).toBe(true);
  });
});
