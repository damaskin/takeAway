import { storeKinds, storeMatchesKind } from './store-kinds';

describe('storeKinds', () => {
  it('counts a store without the field as a coffee shop', () => {
    expect(storeKinds({ id: 'old-api' })).toEqual(['COFFEE']);
    expect(storeKinds({ id: 'null', kinds: null })).toEqual(['COFFEE']);
  });

  it('counts a store that has not said as a coffee shop', () => {
    expect(storeKinds({ id: 'empty', kinds: [] })).toEqual(['COFFEE']);
  });

  it('keeps what the store sells, coffee first, once each', () => {
    expect(storeKinds({ id: 'food', kinds: ['FOOD'] })).toEqual(['FOOD']);
    expect(storeKinds({ id: 'both', kinds: ['FOOD', 'COFFEE', 'FOOD'] })).toEqual(['COFFEE', 'FOOD']);
  });

  it('ignores a kind this build does not know', () => {
    expect(storeKinds({ id: 'future', kinds: ['FLOWERS', 'FOOD'] })).toEqual(['FOOD']);
    expect(storeKinds({ id: 'only-future', kinds: ['FLOWERS'] })).toEqual(['COFFEE']);
  });
});

describe('storeMatchesKind', () => {
  const coffee = { id: 'coffee', kinds: ['COFFEE'] };
  const food = { id: 'food', kinds: ['FOOD'] };
  const both = { id: 'both', kinds: ['COFFEE', 'FOOD'] };
  const unknown = { id: 'unknown' };

  it('lets every store through "All"', () => {
    expect([coffee, food, both, unknown].every((s) => storeMatchesKind(s, 'ALL'))).toBe(true);
  });

  it('shows coffee shops, places selling both, and stores that have not said under "Coffee"', () => {
    expect([coffee, food, both, unknown].filter((s) => storeMatchesKind(s, 'COFFEE'))).toEqual([coffee, both, unknown]);
  });

  it('shows only the stores that sell food under "Food"', () => {
    expect([coffee, food, both, unknown].filter((s) => storeMatchesKind(s, 'FOOD'))).toEqual([food, both]);
  });
});
