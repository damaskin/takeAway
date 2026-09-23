import {
  describeOrderItemOptions,
  isCartChangedError,
  readOrderItemSnapshot,
  sortVariationsForDisplay,
} from './order-item';

describe('order item snapshot', () => {
  const current = {
    id: 'p-latte',
    slug: 'latte',
    name: 'Латте',
    variationIds: ['v-oat', 'v-l'],
    modifiers: { 'm-vanilla': 2 },
    notes: 'поменьше пены',
    unitPrepSeconds: 240,
    // Stored out of reading order on purpose: the reader owns the order.
    variations: [
      { id: 'v-oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 60 },
      { id: 'v-l', type: 'SIZE', name: 'L', priceDeltaCents: 140 },
    ],
    modifierLines: [{ id: 'm-vanilla', name: 'Ваниль', count: 2, priceCents: 50 }],
  };

  describe('readOrderItemSnapshot', () => {
    it('reads a current snapshot with size before milk', () => {
      const snap = readOrderItemSnapshot(current);

      expect(snap.name).toBe('Латте');
      expect(snap.variations.map((v) => v.name)).toEqual(['L', 'Овсяное']);
      expect(snap.modifierLines).toEqual([{ id: 'm-vanilla', name: 'Ваниль', count: 2, priceCents: 50 }]);
      expect(snap.notes).toBe('поменьше пены');
      expect(snap.modifiers).toEqual({ 'm-vanilla': 2 });
    });

    it('reads an order placed before options were snapshotted as its name and notes', () => {
      const snap = readOrderItemSnapshot({
        id: 'p-latte',
        slug: 'latte',
        name: 'Латте',
        variationIds: ['v-l'],
        modifiers: { 'm-vanilla': 1 },
        notes: 'без сахара',
        unitPrepSeconds: 180,
      });

      expect(snap.name).toBe('Латте');
      expect(snap.variations).toEqual([]);
      expect(snap.modifierLines).toEqual([]);
      expect(snap.notes).toBe('без сахара');
      expect(snap.variationIds).toEqual(['v-l']);
    });

    it('survives something that is not a snapshot at all', () => {
      for (const raw of [null, undefined, 'Латте', 42, ['x']]) {
        const snap = readOrderItemSnapshot(raw);
        expect(snap.name).toBe('');
        expect(snap.variations).toEqual([]);
        expect(snap.modifierLines).toEqual([]);
        expect(snap.notes).toBeNull();
      }
    });

    it('drops malformed entries instead of rendering them', () => {
      const snap = readOrderItemSnapshot({
        ...current,
        notes: '   ',
        variations: [
          { id: 'v-x', type: 'FLAVOUR', name: 'Unknown type', priceDeltaCents: 0 },
          { id: 'v-y', type: 'SIZE' },
          { id: 'v-l', type: 'SIZE', name: 'L' },
        ],
        modifierLines: [
          { id: 'm-0', name: 'None taken', count: 0, priceCents: 50 },
          { id: 'm-1', name: 'Shot', count: 1 },
        ],
      });

      expect(snap.variations).toEqual([{ id: 'v-l', type: 'SIZE', name: 'L', priceDeltaCents: 0 }]);
      expect(snap.modifierLines).toEqual([{ id: 'm-1', name: 'Shot', count: 1, priceCents: 0 }]);
      expect(snap.notes).toBeNull();
    });
  });

  describe('describeOrderItemOptions', () => {
    it('lists the variations, then the extras with their counts', () => {
      expect(describeOrderItemOptions(readOrderItemSnapshot(current))).toBe('L · Овсяное · +Ваниль ×2');
    });

    it('is empty for a line without options', () => {
      expect(describeOrderItemOptions({ variations: [], modifierLines: [] })).toBe('');
    });
  });

  it('sorts variations into reading order and keeps ties stable', () => {
    const sorted = sortVariationsForDisplay([
      { type: 'CUP' as const, name: 'own cup' },
      { type: 'TEMPERATURE' as const, name: 'iced' },
      { type: 'MILK' as const, name: 'oat' },
      { type: 'SIZE' as const, name: 'L' },
    ]);
    expect(sorted.map((v) => v.name)).toEqual(['L', 'oat', 'iced', 'own cup']);
  });

  it('recognises the cart-changed conflict body', () => {
    expect(isCartChangedError({ statusCode: 409, code: 'CART_CHANGED', message: 'x', items: [] })).toBe(true);
    expect(isCartChangedError({ statusCode: 409, message: 'Conflict' })).toBe(false);
    expect(isCartChangedError(null)).toBe(false);
  });
});
