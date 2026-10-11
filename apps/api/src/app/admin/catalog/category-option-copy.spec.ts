import type { Prisma } from '@prisma/client';

import { copyCategoryOptions, planOptionCopy, type ProductOptions, type SetOption } from './category-option-copy';

const variation = (
  variationType: SetOption['variationType'],
  name: string,
  patch: Partial<SetOption> = {},
): SetOption => ({
  kind: 'VARIATION',
  variationType,
  name,
  priceDeltaCents: 0,
  group: null,
  isDefault: false,
  maxCount: 1,
  ingredientId: null,
  ...patch,
});

const addOn = (name: string, patch: Partial<SetOption> = {}): SetOption => ({
  kind: 'MODIFIER',
  variationType: null,
  name,
  priceDeltaCents: 0,
  group: null,
  isDefault: false,
  maxCount: 1,
  ingredientId: null,
  ...patch,
});

/** The hot-drinks set a café builds from the preset, with its own prices. */
const HOT_SET: SetOption[] = [
  variation('SIZE', 'Маленький', { isDefault: true }),
  variation('SIZE', 'Большой', { priceDeltaCents: 1000 }),
  variation('MILK', 'Обычное молоко', { isDefault: true, ingredientId: 'ing-milk' }),
  variation('MILK', 'Овсяное молоко', { priceDeltaCents: 800, ingredientId: 'ing-oat' }),
  addOn('Ваниль', { priceDeltaCents: 500, group: 'Сиропы', maxCount: 2, ingredientId: 'ing-vanilla' }),
  addOn('Без сахара', { group: 'Убрать' }),
];

const bare: ProductOptions = { variations: [], modifiers: [] };

describe('planOptionCopy', () => {
  it('gives a product without options the whole set, in order, with defaults and groups', () => {
    const plan = planOptionCopy(HOT_SET, bare);

    expect(plan.variations).toEqual([
      { type: 'SIZE', name: 'Маленький', priceDeltaCents: 0, isDefault: true, ingredientId: null, sortOrder: 0 },
      { type: 'SIZE', name: 'Большой', priceDeltaCents: 1000, isDefault: false, ingredientId: null, sortOrder: 1 },
      {
        type: 'MILK',
        name: 'Обычное молоко',
        priceDeltaCents: 0,
        isDefault: true,
        ingredientId: 'ing-milk',
        sortOrder: 0,
      },
      {
        type: 'MILK',
        name: 'Овсяное молоко',
        priceDeltaCents: 800,
        isDefault: false,
        ingredientId: 'ing-oat',
        sortOrder: 1,
      },
    ]);
    expect(plan.modifiers).toEqual([
      {
        slug: 'vanil',
        name: 'Ваниль',
        priceDeltaCents: 500,
        group: 'Сиропы',
        maxCount: 2,
        ingredientId: 'ing-vanilla',
        sortOrder: 0,
      },
      {
        slug: 'bez-sahara',
        name: 'Без сахара',
        priceDeltaCents: 0,
        group: 'Убрать',
        maxCount: 1,
        ingredientId: null,
        sortOrder: 1,
      },
    ]);
  });

  it('adds nothing the second time', () => {
    const first = planOptionCopy(HOT_SET, bare);
    const after: ProductOptions = {
      variations: first.variations,
      modifiers: first.modifiers,
    };
    expect(planOptionCopy(HOT_SET, after)).toEqual({ variations: [], modifiers: [] });
  });

  // The latte charges 7 for vanilla, not the set's 5, and has no oat milk yet.
  it('keeps what the product has — its own price, name, group and default — and adds the rest', () => {
    const latte: ProductOptions = {
      variations: [
        { type: 'MILK', name: 'Молоко 3,2%', isDefault: true, ingredientId: 'ing-milk', sortOrder: 4 },
        { type: 'MILK', name: 'Миндальное', isDefault: false, ingredientId: null, sortOrder: 5 },
      ],
      modifiers: [{ slug: 'vanil', name: 'Ванильный (двойной)', ingredientId: 'ing-vanilla', sortOrder: 3 }],
    };

    const plan = planOptionCopy(HOT_SET, latte);

    expect(plan.variations.filter((v) => v.type === 'MILK')).toEqual([
      // The house milk is the product's own default; the oat milk joins after it.
      {
        type: 'MILK',
        name: 'Овсяное молоко',
        priceDeltaCents: 800,
        isDefault: false,
        ingredientId: 'ing-oat',
        sortOrder: 6,
      },
    ]);
    expect(plan.modifiers.map((m) => [m.name, m.sortOrder])).toEqual([['Без сахара', 4]]);
  });

  it("does not mix the set's sizes into a product that sells its own", () => {
    const cup: ProductOptions = {
      variations: [{ type: 'SIZE', name: '0,3 л', isDefault: true, ingredientId: null, sortOrder: 0 }],
      modifiers: [],
    };

    const plan = planOptionCopy(HOT_SET, cup);

    expect(plan.variations.some((v) => v.type === 'SIZE')).toBe(false);
    expect(plan.variations.map((v) => v.name)).toEqual(['Обычное молоко', 'Овсяное молоко']);
  });

  it('matches an untracked option by name, whatever the case and spaces', () => {
    const product: ProductOptions = {
      variations: [],
      modifiers: [{ slug: 'bez-sahara', name: ' без сахара ', ingredientId: null, sortOrder: 0 }],
    };
    expect(planOptionCopy([addOn('Без сахара')], product).modifiers).toEqual([]);
  });

  it('gives a new add-on a slug the product does not use yet', () => {
    const product: ProductOptions = {
      variations: [],
      // Another add-on already took the slug «vanil».
      modifiers: [{ slug: 'vanil', name: 'Ванильный сахар', ingredientId: 'ing-sugar', sortOrder: 0 }],
    };
    const plan = planOptionCopy([addOn('Ваниль', { ingredientId: 'ing-vanilla' }), addOn('🔥')], product);
    expect(plan.modifiers.map((m) => m.slug)).toEqual(['vanil-2', 'option']);
  });
});

describe('copyCategoryOptions', () => {
  function db(set: SetOption[], products: Array<{ id: string } & ProductOptions>) {
    return {
      categoryOption: { findMany: jest.fn().mockResolvedValue(set) },
      product: { findMany: jest.fn().mockResolvedValue(products) },
      variation: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      modifier: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
  }

  it('copies onto every product of the category what each lacks, and counts it', async () => {
    const fake = db(HOT_SET, [
      { id: 'p-latte', ...bare },
      {
        id: 'p-done',
        variations: planOptionCopy(HOT_SET, bare).variations,
        modifiers: planOptionCopy(HOT_SET, bare).modifiers,
      },
    ]);

    const result = await copyCategoryOptions(fake as unknown as Prisma.TransactionClient, 'cat-hot');

    expect(result).toEqual({ total: 2, products: 1, variations: 4, modifiers: 2 });
    expect(fake.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { categoryId: 'cat-hot' } }));
    expect(fake.variation.createMany).toHaveBeenCalledTimes(1);
    expect(
      fake.variation.createMany.mock.calls[0][0].data.every((v: { productId: string }) => v.productId === 'p-latte'),
    ).toBe(true);
  });

  it('does not even load the products of a category without a set', async () => {
    const fake = db([], [{ id: 'p-latte', ...bare }]);

    const result = await copyCategoryOptions(fake as unknown as Prisma.TransactionClient, 'cat-hot');

    expect(result).toEqual({ total: 0, products: 0, variations: 0, modifiers: 0 });
    expect(fake.product.findMany).not.toHaveBeenCalled();
  });
});
