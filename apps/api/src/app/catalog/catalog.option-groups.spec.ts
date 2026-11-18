import { NotFoundException } from '@nestjs/common';
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
/** An add-on nobody has to take. */
const SUGAR: ProductOptionGroup = {
  id: 'og_sugar',
  kind: 'ADDON',
  type: 'B',
  name: 'Сахар',
  minSelect: null,
  maxSelect: null,
  showIfOptionId: null,
  options: [option('oi_sugar', 'Сахар')],
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

function build(groups: Record<string, ProductOptionGroup[]>, products = ['p-cappuccino', 'p-iced', 'p-tea']) {
  const names: Record<string, string> = { 'p-cappuccino': 'Капучино', 'p-iced': 'Айс-латте', 'p-tea': 'Чай' };
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
          kind: 'HOT_DRINKS',
          products: products.map((id) => product(id, names[id] ?? id)),
        },
      ]),
    },
    product: {
      findFirst: jest.fn().mockResolvedValue({
        ...product('p-cappuccino', 'Капучино'),
        category: { kind: 'HOT_DRINKS' },
      }),
    },
  };
  const stub = optionGroupsStub(groups, []);
  const forProducts = jest.spyOn(stub, 'forProducts');
  const service = new CatalogService(
    prisma as unknown as PrismaService,
    { deliveryEnabled: true } as FeatureFlagsService,
    {} as KitchenLoadService,
    {} as StoreAvailabilityService,
    stub,
  );
  return { service, forProducts, prisma };
}

describe('CatalogService with the options catalog', () => {
  it('flags the menu tiles that need a look before they go in the cart, in one batch', async () => {
    const { service, forProducts } = build({
      'p-cappuccino': [SIZE, SERVING, SUGAR],
      'p-iced': [SERVING, SUGAR],
      'p-tea': [SERVING, SUGAR],
    });

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

  it('sends the groups of a product, and the older option fields empty for the app builds that read them', async () => {
    const { service } = build({ 'p-cappuccino': [SIZE, SERVING, SUGAR] });

    const detail = await service.getProduct('p-cappuccino', 'center');

    expect(detail.optionGroups).toEqual([SIZE, SERVING, SUGAR]);
    expect(detail.hasRequiredOptions).toBe(true);
    expect(detail.variations).toEqual([]);
    expect(detail.modifiers).toEqual([]);
  });

  // Owner, 2026-11-18: customers see a product only with a variant and an add-on.
  describe('a product without a variant or an add-on', () => {
    it('is left out of the menu, and so is a category left with none', async () => {
      const { service } = build({ 'p-cappuccino': [SIZE, SUGAR], 'p-iced': [SERVING], 'p-tea': [SUGAR] });

      const menu = await service.getMenu('center');

      expect(menu.categories[0]?.products.map((p) => p.id)).toEqual(['p-cappuccino']);

      const empty = build({ 'p-cappuccino': [SIZE], 'p-iced': [], 'p-tea': [SUGAR] });
      expect((await empty.service.getMenu('center')).categories).toEqual([]);
    });

    it('is not found on its own page, with a store or without', async () => {
      const { service } = build({ 'p-cappuccino': [SIZE, SERVING] });

      await expect(service.getProduct('p-cappuccino', 'center')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getProduct('p-cappuccino')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is not found without any group at all', async () => {
      const { service } = build({});

      await expect(service.getProduct('p-cappuccino')).rejects.toBeInstanceOf(NotFoundException);
      expect((await service.getMenu('center')).categories).toEqual([]);
    });

    it('is shown again once it has both', async () => {
      const { service } = build({ 'p-cappuccino': [SERVING, SUGAR] });

      expect((await service.getProduct('p-cappuccino')).optionGroups).toEqual([SERVING, SUGAR]);
    });
  });
});
