import type { CategoryKind, CategoryWithProducts, ProductSummary } from '@takeaway/shared-types';

import { isDrinkKind, isFoodKind, menuProductKinds, nutritionFacts, productKind, showsNutrition } from './product-kind';

function product(id: string, categoryKind?: CategoryKind): ProductSummary {
  return {
    id,
    categoryId: 'cat',
    slug: id,
    name: id,
    description: null,
    basePriceCents: 100,
    prepTimeSeconds: 60,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
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

describe('showsNutrition', () => {
  it('shows calories and nutrition for meals only', () => {
    expect(showsNutrition('FOOD')).toBe(true);
    for (const kind of ['HOT_DRINKS', 'COLD_DRINKS', 'BAKERY', 'OTHER'] as const) {
      expect(showsNutrition(kind)).toBe(false);
    }
  });
});

describe('nutritionFacts', () => {
  it('shows calories and every filled macro for a meal, in order', () => {
    expect(nutritionFacts({ calories: 420, proteinsGrams: 18, fatsGrams: 12.5, carbsGrams: 40.04 }, 'FOOD')).toEqual({
      calories: 420,
      macros: [
        { key: 'proteins', grams: '18' },
        { key: 'fats', grams: '12.5' },
        { key: 'carbs', grams: '40' },
      ],
    });
  });

  it('skips what the brand left empty', () => {
    expect(
      nutritionFacts({ calories: null, proteinsGrams: 7, fatsGrams: null, carbsGrams: undefined }, 'FOOD'),
    ).toEqual({
      calories: null,
      macros: [{ key: 'proteins', grams: '7' }],
    });
    expect(nutritionFacts({ calories: 0, proteinsGrams: 0 }, 'FOOD')).toEqual({
      calories: 0,
      macros: [{ key: 'proteins', grams: '0' }],
    });
  });

  it('shows nothing when nothing is filled or the product is not a meal', () => {
    expect(
      nutritionFacts({ calories: null, proteinsGrams: null, fatsGrams: null, carbsGrams: null }, 'FOOD'),
    ).toBeNull();
    expect(nutritionFacts({ calories: 120, proteinsGrams: 4, fatsGrams: 3, carbsGrams: 9 }, 'HOT_DRINKS')).toBeNull();
    expect(nutritionFacts({ calories: 300, proteinsGrams: 4 }, 'BAKERY')).toBeNull();
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
