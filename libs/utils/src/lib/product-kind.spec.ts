import type { CategoryKind, CategoryWithProducts, ProductSummary } from '@takeaway/shared-types';

import { isDrinkKind, isFoodKind, menuProductKinds, productKind } from './product-kind';

function product(id: string, categoryKind?: CategoryKind): ProductSummary {
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
    ...(categoryKind ? { categoryKind } : {}),
  };
}

function category(products: ProductSummary[], kind?: CategoryKind): CategoryWithProducts {
  return {
    id: 'cat',
    slug: 'cat',
    name: 'cat',
    description: null,
    iconUrl: null,
    sortOrder: 0,
    availableFrom: null,
    availableTo: null,
    products,
    ...(kind ? { kind } : {}),
  };
}

describe('productKind', () => {
  it("takes the product's own kind first", () => {
    expect(productKind({ categoryKind: 'BAKERY' }, { kind: 'HOT_DRINKS' })).toBe('BAKERY');
  });

  it("falls back to the menu category's kind", () => {
    expect(productKind({}, { kind: 'COLD_DRINKS' })).toBe('COLD_DRINKS');
    expect(productKind({ categoryKind: null }, { kind: 'FOOD' })).toBe('FOOD');
  });

  it('reads an API without kinds, or a kind this build does not know, as OTHER', () => {
    expect(productKind({})).toBe('OTHER');
    expect(productKind({}, null)).toBe('OTHER');
    expect(productKind({ categoryKind: 'FLOWERS' }, { kind: 'SOUPS' })).toBe('OTHER');
  });
});

describe('isDrinkKind / isFoodKind', () => {
  it('tells drinks from food, with OTHER being neither', () => {
    expect(isDrinkKind('HOT_DRINKS') && isDrinkKind('COLD_DRINKS')).toBe(true);
    expect(isFoodKind('FOOD') && isFoodKind('BAKERY')).toBe(true);
    expect(isDrinkKind('OTHER') || isFoodKind('OTHER')).toBe(false);
    expect(isDrinkKind('BAKERY')).toBe(false);
  });
});

describe('menuProductKinds', () => {
  it('maps each product of a menu to its kind', () => {
    const kinds = menuProductKinds({
      categories: [
        category([product('latte'), product('cookie', 'BAKERY')], 'HOT_DRINKS'),
        category([product('water')]),
      ],
    });
    expect(Object.fromEntries(kinds)).toEqual({ latte: 'HOT_DRINKS', cookie: 'BAKERY', water: 'OTHER' });
  });
});
