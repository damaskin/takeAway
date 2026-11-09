import type { ProductOptionGroup } from '@takeaway/shared-types';

import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import { optionGroupsStub } from '../option-groups/testing/option-groups.stub';
import type { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const option = (id: string, name: string, isDefault = false) => ({
  id,
  name,
  note: null,
  isDefault,
  minQty: null,
  maxQty: null,
  defaultQty: null,
  priceCents: 0,
  available: true,
  sortOrder: 0,
});

/** A size to pick: no default. */
const SIZE: ProductOptionGroup = {
  id: 'og_coffee_size',
  kind: 'VARIANT',
  type: 'A',
  name: 'Размер (кофе)',
  minSelect: 1,
  maxSelect: 1,
  showIfOptionId: null,
  options: [option('oi_s', 'S'), option('oi_m', 'M')],
};
/** Hot by default: a valid choice as it opens. */
const SERVING: ProductOptionGroup = {
  ...SIZE,
  id: 'og_serving',
  name: 'Подача',
  options: [option('oi_hot', 'Горячий', true), option('oi_cold', 'Холодный')],
};

function product(id: string, name: string) {
  return {
    id,
    categoryId: 'cat-coffee',
    brandId: 'brand-a',
    slug: id,
    name,
    description: null,
    basePriceCents: 4500,
    prepTimeSeconds: 180,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    imageUrls: [],
    sortOrder: 0,
  };
}

function build(groups: Record<string, ProductOptionGroup[]>) {
  const prisma = {
    store: { findFirst: jest.fn().mockResolvedValue({ id: 'store-1', slug: 'center', brandId: 'brand-a' }) },
    stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
    category: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'cat-coffee',
          slug: 'coffee',
          name: 'Кофе',
          description: null,
          iconUrl: null,
          sortOrder: 0,
          availableFrom: null,
          availableTo: null,
          kind: 'DRINK',
          products: [product('p-cappuccino', 'Капучино'), product('p-iced', 'Айс-латте'), product('p-tea', 'Чай')],
        },
      ]),
    },
    product: {
      findFirst: jest.fn().mockResolvedValue({
        ...product('p-cappuccino', 'Капучино'),
        category: { kind: 'DRINK' },
        variations: [
          {
            id: 'v-l',
            type: 'SIZE',
            name: 'L',
            priceDeltaCents: 100,
            prepTimeDeltaSeconds: 0,
            sortOrder: 0,
            isDefault: true,
            ingredient: null,
          },
        ],
        modifiers: [
          {
            id: 'm-1',
            slug: 'm-1',
            name: 'Ваниль',
            priceDeltaCents: 50,
            prepTimeDeltaSeconds: 0,
            minCount: 0,
            maxCount: 3,
            sortOrder: 0,
            group: null,
          },
        ],
      }),
    },
  };
  const stub = optionGroupsStub(groups);
  const forProducts = jest.spyOn(stub, 'forProducts');
  const service = new CatalogService(
    prisma as unknown as PrismaService,
    { deliveryEnabled: true } as FeatureFlagsService,
    {} as KitchenLoadService,
    {} as StoreAvailabilityService,
    stub,
  );
  return { service, forProducts };
}

describe('CatalogService with the options catalog', () => {
  it('flags the menu tiles that need a look before they go in the cart, in one batch', async () => {
    const { service, forProducts } = build({ 'p-cappuccino': [SIZE, SERVING], 'p-iced': [SERVING] });

    const menu = await service.getMenu('center');
    const flags = menu.categories[0]?.products.map((p) => [p.name, p.hasRequiredOptions]);

    expect(flags).toEqual([
      ['Капучино', true],
      ['Айс-латте', false],
      ['Чай', false],
    ]);
    expect(forProducts).toHaveBeenCalledTimes(1);
    expect(forProducts).toHaveBeenCalledWith(['p-cappuccino', 'p-iced', 'p-tea'], {
      brandId: 'brand-a',
      storeId: 'store-1',
    });
  });

  it('sends the groups of a catalog product and none of its older options', async () => {
    const { service } = build({ 'p-cappuccino': [SIZE, SERVING] });

    const detail = await service.getProduct('p-cappuccino', 'center');

    expect(detail.optionGroups).toEqual([SIZE, SERVING]);
    expect(detail.hasRequiredOptions).toBe(true);
    expect(detail.variations).toEqual([]);
    expect(detail.modifiers).toEqual([]);
  });

  it('keeps the older options of a product without catalog groups', async () => {
    const { service } = build({});

    const detail = await service.getProduct('p-cappuccino');

    expect(detail.optionGroups).toEqual([]);
    expect(detail.hasRequiredOptions).toBe(false);
    expect(detail.variations.map((v) => v.id)).toEqual(['v-l']);
    expect(detail.modifiers.map((m) => m.id)).toEqual(['m-1']);
  });
});
