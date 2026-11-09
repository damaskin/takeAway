import type { BrandOptionSetting, CatalogGroup, CatalogOption } from '@takeaway/shared-types';

import {
  attachableGroups,
  attachedGroups,
  configFromDraft,
  draftFromConfig,
  effectiveDefault,
  isQtyRangeValid,
  isSelectRangeValid,
  moveWrites,
  nextSortOrder,
  sameConfig,
  settingFor,
  settingsById,
  sortCatalog,
  withDefault,
  withDelta,
  withGroup,
  withGroupMoved,
  withoutGroup,
} from './option-catalog';

function option(groupId: string, id: string, sortOrder: number, extra: Partial<CatalogOption> = {}): CatalogOption {
  return {
    id,
    groupId,
    name: id,
    note: null,
    isDefault: false,
    minQty: null,
    maxQty: null,
    defaultQty: null,
    sortOrder,
    ...extra,
  };
}

function group(id: string, extra: Partial<CatalogGroup> = {}): CatalogGroup {
  return {
    id,
    kind: 'ADDON',
    type: 'A',
    name: id,
    minSelect: 0,
    maxSelect: 1,
    showIfOptionId: null,
    sortOrder: 0,
    options: [],
    ...extra,
  };
}

const SIZE = group('size', {
  kind: 'VARIANT',
  minSelect: 1,
  sortOrder: 5,
  options: [option('size', 's', 0), option('size', 'm', 1, { isDefault: true }), option('size', 'l', 2)],
});
const SERVE = group('serve', {
  kind: 'VARIANT',
  minSelect: 1,
  sortOrder: 6,
  options: [option('serve', 'hot', 0, { isDefault: true }), option('serve', 'cold', 1)],
});
const SYRUPS = group('syrups', {
  maxSelect: 2,
  sortOrder: 1,
  options: [option('syrups', 'vanilla', 0), option('syrups', 'caramel', 1), option('syrups', 'mint', 2)],
});
const NO_ONION = group('remove', {
  type: 'B',
  minSelect: null,
  maxSelect: null,
  options: [option('remove', 'onion', 0)],
});
const SUGAR = group('sugar', {
  type: 'C',
  minSelect: null,
  maxSelect: null,
  options: [option('sugar', 'sugar', 0, { minQty: 0, maxQty: 3, defaultQty: 0 })],
});
const ALL = [SYRUPS, SIZE, NO_ONION, SERVE, SUGAR];

describe('options catalog helpers', () => {
  describe('order', () => {
    it('sorts groups and options by sortOrder, then name', () => {
      const sorted = sortCatalog([
        group('b', { sortOrder: 1 }),
        group('a', { sortOrder: 1, options: [option('a', 'y', 1), option('a', 'x', 0)] }),
        group('c', { sortOrder: 0 }),
      ]);
      expect(sorted.map((g) => g.id)).toEqual(['c', 'a', 'b']);
      expect(sorted[1]?.options.map((o) => o.id)).toEqual(['x', 'y']);
    });

    it('swaps the two neighbours when their numbers differ', () => {
      const list = [
        { id: 'a', sortOrder: 0 },
        { id: 'b', sortOrder: 4 },
        { id: 'c', sortOrder: 9 },
      ];
      expect(moveWrites(list, 1, -1)).toEqual([
        { id: 'b', sortOrder: 0 },
        { id: 'a', sortOrder: 4 },
      ]);
      expect(moveWrites(list, 2, 1)).toEqual([]);
      expect(moveWrites(list, 0, -1)).toEqual([]);
    });

    it('renumbers from 0 when the neighbours share a number, writing only what changes', () => {
      const list = [
        { id: 'a', sortOrder: 0 },
        { id: 'b', sortOrder: 1 },
        { id: 'c', sortOrder: 1 },
      ];
      expect(moveWrites(list, 2, -1)).toEqual([{ id: 'b', sortOrder: 2 }]);
    });

    it('puts a new entry after every listed one', () => {
      expect(nextSortOrder([])).toBe(0);
      expect(nextSortOrder([{ sortOrder: 3 }, { sortOrder: 7 }])).toBe(8);
    });
  });

  describe("the brand's settings", () => {
    it('reads a missing row as offered at price 0', () => {
      expect(settingFor(new Map(), 'x')).toEqual({ optionId: 'x', priceCents: 0, enabled: true, stoppedStoreIds: [] });
    });

    it('offers to attach only groups with an option the brand has, not attached yet', () => {
      const settings = settingsById([
        { optionId: 'onion', priceCents: 0, enabled: false, stoppedStoreIds: [] } satisfies BrandOptionSetting,
      ]);
      const ids = attachableGroups(ALL, settings, new Set(['syrups'])).map((g) => g.id);
      expect(ids).toEqual(['size', 'serve', 'sugar']);
    });
  });

  describe('bounds', () => {
    it('checks an A group: max from 1, min not above max', () => {
      expect(isSelectRangeValid(0, 2)).toBe(true);
      expect(isSelectRangeValid(1, 1)).toBe(true);
      expect(isSelectRangeValid(0, 0)).toBe(false);
      expect(isSelectRangeValid(3, 2)).toBe(false);
    });

    it('checks a counter: 0 ≤ min ≤ start ≤ max ≤ 20, blanks read as 0 / 0 / 20', () => {
      expect(isQtyRangeValid(1, 1, 2)).toBe(true);
      expect(isQtyRangeValid(null, null, null)).toBe(true);
      expect(isQtyRangeValid(2, 1, 3)).toBe(false);
      expect(isQtyRangeValid(0, 4, 3)).toBe(false);
      expect(isQtyRangeValid(0, 0, 21)).toBe(false);
    });
  });

  describe("the product editor's draft", () => {
    const empty = draftFromConfig({ groups: [], overrides: [] });

    it('keeps variants first whatever order they were attached in', () => {
      let draft = withGroup(empty, 'syrups');
      draft = withGroup(draft, 'size');
      draft = withGroup(draft, 'serve');
      expect(attachedGroups(draft, ALL).map((g) => g.id)).toEqual(['size', 'serve', 'syrups']);
      expect(configFromDraft(draft, ALL).groups).toEqual([
        { groupId: 'size', sortOrder: 0 },
        { groupId: 'serve', sortOrder: 1 },
        { groupId: 'syrups', sortOrder: 2 },
      ]);
    });

    it('moves a group within its kind only', () => {
      const draft = { ...empty, groupIds: ['size', 'serve', 'syrups'] };
      expect(withGroupMoved(draft, ALL, 'serve', -1).groupIds).toEqual(['serve', 'size', 'syrups']);
      expect(withGroupMoved(draft, ALL, 'serve', 1).groupIds).toEqual(['size', 'serve', 'syrups']);
      expect(withGroupMoved(draft, ALL, 'syrups', -1).groupIds).toEqual(['size', 'serve', 'syrups']);
    });

    it('stores what a variant adds to the base price, and nothing for one that adds 0', () => {
      let draft = withGroup(empty, 'size');
      draft = withDelta(draft, 'l', 1000);
      draft = withDelta(draft, 's', -500);
      draft = withDelta(draft, 'm', 0);
      expect(configFromDraft(draft, ALL).overrides).toEqual([
        { optionId: 'l', priceCents: 1000, isDefault: null },
        { optionId: 's', priceCents: -500, isDefault: null },
      ]);
    });

    it('moves the default of a one-of group and remembers only what differs from the catalog', () => {
      const draft = withDefault(withGroup(empty, 'size'), SIZE, 'l', true);
      expect(effectiveDefault(draft, SIZE.options[2] as CatalogOption)).toBe(true);
      expect(effectiveDefault(draft, SIZE.options[1] as CatalogOption)).toBe(false);
      expect(configFromDraft(draft, ALL).overrides).toEqual([
        { optionId: 'l', priceCents: null, isDefault: true },
        { optionId: 'm', priceCents: null, isDefault: false },
      ]);
      // Back to the catalog's default: nothing of the product's own is left.
      expect(configFromDraft(withDefault(draft, SIZE, 'm', true), ALL).overrides).toEqual([]);
    });

    it('refuses a default above a several-of group maximum', () => {
      let draft = withGroup(empty, 'syrups');
      draft = withDefault(draft, SYRUPS, 'vanilla', true);
      draft = withDefault(draft, SYRUPS, 'caramel', true);
      expect(withDefault(draft, SYRUPS, 'mint', true)).toBe(draft);
    });

    it('has no defaults to pick on a counter', () => {
      const draft = withGroup(empty, 'sugar');
      expect(withDefault(draft, SUGAR, 'sugar', true)).toBe(draft);
    });

    it('drops the values of a detached group from what is saved', () => {
      const draft = withoutGroup(withDelta(withGroup(empty, 'size'), 'l', 1000), 'size');
      expect(configFromDraft(draft, ALL)).toEqual({ groups: [], overrides: [] });
    });

    it('reads a saved config back to the same thing', () => {
      const saved = {
        groups: [
          { groupId: 'syrups', sortOrder: 1 },
          { groupId: 'size', sortOrder: 0 },
        ],
        overrides: [
          { optionId: 'l', priceCents: 1000, isDefault: null },
          { optionId: 'vanilla', priceCents: null, isDefault: true },
        ],
      };
      const read = configFromDraft(draftFromConfig(saved), ALL);
      expect(sameConfig(read, configFromDraft(draftFromConfig(read), ALL))).toBe(true);
      expect(read).toEqual({
        groups: [
          { groupId: 'size', sortOrder: 0 },
          { groupId: 'syrups', sortOrder: 1 },
        ],
        overrides: saved.overrides,
      });
    });
  });
});
