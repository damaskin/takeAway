import type { CategoryKind, CategoryWithProducts, ProductSummary } from '@takeaway/shared-types';

import { suggestFood, suggestionRow } from './upsell';

function product(id: string, over: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id,
    categoryId: 'cat',
    slug: id,
    name: id,
    description: null,
    basePriceCents: 100,
    prepTimeSeconds: 60,
    caffeineLevel: null,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    allergens: [],
    dietTags: [],
    imageUrls: [],
    sortOrder: 0,
    ...over,
  };
}

function category(id: string, products: ProductSummary[], kind?: CategoryKind): CategoryWithProducts {
  return {
    id,
    slug: id,
    name: id,
    description: null,
    iconUrl: null,
    sortOrder: 0,
    availableFrom: null,
    availableTo: null,
    products,
    ...(kind ? { kind } : {}),
  };
}

const ids = (list: { product: ProductSummary }[]) => list.map((s) => s.product.id);

describe('suggestFood', () => {
  const menu = {
    categories: [
      category('coffee', [product('latte'), product('cappuccino')], 'HOT_DRINKS'),
      category('iced', [product('ice-latte')], 'COLD_DRINKS'),
      category(
        'pastry',
        [product('croissant'), product('cookie', { onStopList: true }), product('muffin'), product('eclair')],
        'BAKERY',
      ),
      category('kitchen', [product('sandwich'), product('salad')], 'FOOD'),
      category('other', [product('beans')], 'OTHER'),
    ],
  };

  it('offers bakery and food next to a drink, the categories taking turns', () => {
    expect(ids(suggestFood(menu, ['latte']))).toEqual(['croissant', 'sandwich', 'muffin', 'salad', 'eclair']);
  });

  it('carries the kind for the placeholder', () => {
    expect(suggestFood(menu, ['ice-latte'], 2).map((s) => s.kind)).toEqual(['BAKERY', 'FOOD']);
  });

  it('stops at the limit', () => {
    expect(ids(suggestFood(menu, ['latte'], 3))).toEqual(['croissant', 'sandwich', 'muffin']);
    expect(suggestFood(menu, ['latte'], 0)).toEqual([]);
  });

  it('leaves out what is sold out', () => {
    expect(ids(suggestFood(menu, ['latte']))).not.toContain('cookie');
  });

  it('offers nothing once there is something to eat already', () => {
    expect(suggestFood(menu, ['latte', 'croissant'])).toEqual([]);
    expect(suggestFood(menu, ['latte', 'salad'])).toEqual([]);
  });

  it('offers nothing without a drink', () => {
    expect(suggestFood(menu, [])).toEqual([]);
    expect(suggestFood(menu, ['beans'])).toEqual([]);
    expect(suggestFood(menu, ['gone-from-menu'])).toEqual([]);
  });

  it("uses a product's own kind over its category's", () => {
    const mixed = {
      categories: [category('drinks', [product('latte'), product('cookie', { categoryKind: 'BAKERY' })], 'HOT_DRINKS')],
    };
    expect(ids(suggestFood(mixed, ['latte']))).toEqual(['cookie']);
  });

  it('offers nothing on a menu without kinds, as from an older API', () => {
    const old = { categories: [category('coffee', [product('latte')]), category('pastry', [product('croissant')])] };
    expect(suggestFood(old, ['latte'])).toEqual([]);
  });

  it('offers nothing without a menu, or when the store sells no food', () => {
    expect(suggestFood(null, ['latte'])).toEqual([]);
    expect(suggestFood({ categories: [menu.categories[0] as CategoryWithProducts] }, ['latte'])).toEqual([]);
  });
});

describe('suggestionRow', () => {
  const menu = {
    categories: [
      category('coffee', [product('latte'), product('americano')], 'HOT_DRINKS'),
      category('pastry', [product('croissant'), product('cookie', { onStopList: true })], 'BAKERY'),
      category('kitchen', [product('sandwich')], 'FOOD'),
    ],
  };
  const together = (...productIds: string[]) => ({ productIds, source: 'copurchase' as const });

  it("shows what was bought together in the API's order, with each product's kind", () => {
    const row = suggestionRow(menu, ['latte'], together('sandwich', 'americano'));
    expect(row.source).toBe('copurchase');
    expect(row.items.map((s) => [s.product.id, s.kind])).toEqual([
      ['sandwich', 'FOOD'],
      ['americano', 'HOT_DRINKS'],
    ]);
  });

  it('drops what this copy of the menu no longer sells, has sold out or is in hand, and keeps to the limit', () => {
    const row = suggestionRow(
      menu,
      ['latte'],
      together('gone', 'cookie', 'latte', 'croissant', 'croissant', 'sandwich'),
      1,
    );
    expect(row).toMatchObject({ source: 'copurchase', items: [{ product: { id: 'croissant' } }] });
  });

  it('falls back to the menu rule when the answer is the rule, failed, or holds nothing left to offer', () => {
    const rule = ['croissant', 'sandwich'];
    expect(ids(suggestionRow(menu, ['latte'], { productIds: ['sandwich'], source: 'rule' }).items)).toEqual(rule);
    expect(suggestionRow(menu, ['latte'], null)).toMatchObject({ source: 'rule' });
    expect(ids(suggestionRow(menu, ['latte'], null).items)).toEqual(rule);
    expect(ids(suggestionRow(menu, ['latte'], together('cookie', 'gone')).items)).toEqual(rule);
    // An older API's empty answer, without a source.
    expect(ids(suggestionRow(menu, ['latte'], {} as never).items)).toEqual(rule);
  });

  it('shows nothing until the answer lands, or without a menu', () => {
    expect(suggestionRow(menu, ['latte'], undefined)).toEqual({ items: [], source: 'rule' });
    expect(suggestionRow(null, ['latte'], together('croissant'))).toEqual({ items: [], source: 'rule' });
  });
});
