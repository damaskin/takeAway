import type { CategoryKind, CategoryWithProducts, ProductSummary } from '@takeaway/shared-types';

import { suggestFood } from './upsell';

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
