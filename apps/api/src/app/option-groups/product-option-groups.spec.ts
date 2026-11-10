import type { PrismaService } from '../prisma/prisma.service';
import {
  type AttachedGroupRow,
  type BrandSettingRow,
  ProductOptionGroupsService,
  buildProductOptionGroups,
} from './product-option-groups.service';

type Option = AttachedGroupRow['group']['options'][number];

function option(id: string, name: string, patch: Partial<Option> = {}): Option {
  return {
    id,
    name,
    note: null,
    isDefault: false,
    minQty: null,
    maxQty: null,
    defaultQty: null,
    sortOrder: 0,
    ...patch,
  };
}

function row(
  group: Partial<AttachedGroupRow['group']> & Pick<AttachedGroupRow['group'], 'id' | 'kind' | 'type' | 'name'>,
  sortOrder = 0,
  productId = 'p-latte',
): AttachedGroupRow {
  return {
    productId,
    sortOrder,
    group: {
      minSelect: null,
      maxSelect: null,
      showIfOptionId: null,
      showIfOption: null,
      sortOrder: 0,
      options: [],
      ...group,
    },
  };
}

const size = row({
  id: 'og_coffee_size',
  kind: 'VARIANT',
  type: 'A',
  name: 'Размер (кофе)',
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 10,
  options: [
    option('oi_m', 'M', { note: '300–350 мл', sortOrder: 20 }),
    option('oi_s', 'S', { note: '150–250 мл', sortOrder: 10, minQty: 5 }),
  ],
});
const serving = row({
  id: 'og_serving',
  kind: 'VARIANT',
  type: 'A',
  name: 'Подача',
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 20,
  options: [
    option('oi_hot', 'Горячий', { isDefault: true, sortOrder: 10 }),
    option('oi_cold', 'Холодный', { sortOrder: 20 }),
  ],
});
const milk = row({
  id: 'og_milk',
  kind: 'ADDON',
  type: 'A',
  name: 'Молоко',
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 50,
  options: [
    option('oi_cow', 'Коровье', { isDefault: true, sortOrder: 10 }),
    option('oi_oat', 'Овсяное', { sortOrder: 30 }),
  ],
});
const ice = row({
  id: 'og_ice',
  kind: 'ADDON',
  type: 'C',
  name: 'Лёд',
  sortOrder: 120,
  showIfOptionId: 'oi_cold',
  showIfOption: { groupId: 'og_serving' },
  options: [option('oi_ice', 'Лёд', { minQty: 0, maxQty: 3, defaultQty: 0 })],
});

const none = new Map<string, BrandSettingRow>();

describe('buildProductOptionGroups', () => {
  it('puts variants first, then follows the product order, then the catalog order', () => {
    // The product lists milk before the sizes; variants still come first.
    const groups = buildProductOptionGroups(
      [row(milk.group, 0), row(serving.group, 5), row(size.group, 5)],
      [],
      none,
      new Set(),
    );

    expect(groups.map((g) => g.id)).toEqual(['og_coffee_size', 'og_serving', 'og_milk']);
  });

  it('lists options in catalog order and nulls the fields of other types', () => {
    const [group] = buildProductOptionGroups([size], [], none, new Set());

    expect(group?.options.map((o) => [o.name, o.note])).toEqual([
      ['S', '150–250 мл'],
      ['M', '300–350 мл'],
    ]);
    // A counter's bounds mean nothing on an A option.
    expect(group?.options[0]).toMatchObject({ minQty: null, maxQty: null, defaultQty: null });
    expect(group).toMatchObject({ minSelect: 1, maxSelect: 1 });
  });

  it('prices variants per product and add-ons per brand; no row is 0', () => {
    const settings = new Map<string, BrandSettingRow>([
      ['oi_oat', { optionId: 'oi_oat', priceCents: 1000, enabled: true }],
      // A brand price on a variant is not read.
      ['oi_m', { optionId: 'oi_m', priceCents: 999, enabled: true }],
    ]);
    const overrides = [
      { productId: 'p-latte', optionId: 'oi_m', priceCents: 700, isDefault: null },
      // An override's price on an add-on is not read either.
      { productId: 'p-latte', optionId: 'oi_cow', priceCents: 50, isDefault: null },
    ];
    const groups = buildProductOptionGroups([size, milk], overrides, settings, new Set());
    const price = (id: string) => groups.flatMap((g) => g.options).find((o) => o.id === id)?.priceCents;

    expect(price('oi_m')).toBe(700);
    expect(price('oi_s')).toBe(0);
    expect(price('oi_oat')).toBe(1000);
    expect(price('oi_cow')).toBe(0);
  });

  it("leaves out what the brand switched off, and a group left empty; marks the store's stops", () => {
    const settings = new Map<string, BrandSettingRow>([
      ['oi_s', { optionId: 'oi_s', priceCents: 0, enabled: false }],
      ['oi_m', { optionId: 'oi_m', priceCents: 0, enabled: false }],
      ['oi_oat', { optionId: 'oi_oat', priceCents: 0, enabled: false }],
    ]);
    const groups = buildProductOptionGroups([size, milk], [], settings, new Set(['oi_cow']));

    expect(groups.map((g) => g.id)).toEqual(['og_milk']);
    expect(groups[0]?.options).toEqual([expect.objectContaining({ id: 'oi_cow', available: false })]);
  });

  it("takes the product's default over the catalog's", () => {
    const overrides = [
      { productId: 'p-latte', optionId: 'oi_cow', priceCents: null, isDefault: false },
      { productId: 'p-latte', optionId: 'oi_oat', priceCents: null, isDefault: true },
    ];
    const [group] = buildProductOptionGroups([milk], overrides, none, new Set());

    expect(group?.options.map((o) => [o.id, o.isDefault])).toEqual([
      ['oi_cow', false],
      ['oi_oat', true],
    ]);
  });

  it('keeps a conditional group whose condition is not on the product (a cola shows its ice)', () => {
    const groups = buildProductOptionGroups([ice], [], none, new Set());

    expect(groups.map((g) => g.id)).toEqual(['og_ice']);
    expect(groups[0]).toMatchObject({ showIfOptionId: 'oi_cold', minSelect: null, maxSelect: null });
    expect(groups[0]?.options[0]).toMatchObject({ minQty: 0, maxQty: 3, defaultQty: 0 });
  });

  it('drops a conditional group whose condition the brand switched off on a product that has it', () => {
    const settings = new Map<string, BrandSettingRow>([
      ['oi_cold', { optionId: 'oi_cold', priceCents: 0, enabled: false }],
    ]);
    const groups = buildProductOptionGroups([serving, ice], [], settings, new Set());

    // No iced coffee at this brand: no ice counter on its hot latte either.
    expect(groups.map((g) => g.id)).toEqual(['og_serving']);
  });

  it('never sends a reserved type D group', () => {
    const groups = buildProductOptionGroups(
      [row({ id: 'og_d', kind: 'ADDON', type: 'D', name: 'D', options: [option('oi_d', 'D')] })],
      [],
      none,
      new Set(),
    );
    expect(groups).toEqual([]);
  });
});

describe('ProductOptionGroupsService', () => {
  function prismaWith(rows: AttachedGroupRow[]) {
    return {
      productOptionGroup: { findMany: jest.fn().mockResolvedValue(rows) },
      productOptionOverride: { findMany: jest.fn().mockResolvedValue([]) },
      brandOptionSetting: {
        findMany: jest.fn().mockResolvedValue([{ optionId: 'oi_oat', priceCents: 1000, enabled: true }]),
      },
      storeOptionStop: { findMany: jest.fn().mockResolvedValue([{ optionId: 'oi_oat' }]) },
    };
  }

  it('reads a whole menu in four queries and returns only products with groups', async () => {
    const prisma = prismaWith([row(milk.group, 0, 'p-latte'), row(size.group, 0, 'p-flat')]);
    const service = new ProductOptionGroupsService(prisma as unknown as PrismaService);

    const now = new Date('2026-11-09T10:00:00Z');
    const map = await service.forProducts(['p-latte', 'p-flat', 'p-croissant', 'p-latte'], {
      brandId: 'brand-a',
      storeId: 'store-1',
      now,
    });

    expect([...map.keys()].sort()).toEqual(['p-flat', 'p-latte']);
    expect(map.get('p-latte')?.[0]?.options.find((o) => o.id === 'oi_oat')).toMatchObject({
      priceCents: 1000,
      available: false,
    });
    expect(prisma.productOptionGroup.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.productOptionGroup.findMany.mock.calls[0][0].where).toEqual({
      productId: { in: ['p-latte', 'p-flat', 'p-croissant'] },
    });
    expect(prisma.brandOptionSetting.findMany.mock.calls[0][0].where).toMatchObject({ brandId: 'brand-a' });
    expect(prisma.storeOptionStop.findMany.mock.calls[0][0].where).toMatchObject({
      storeId: 'store-1',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
  });

  it('reads no stops without a store, and nothing else for products without groups', async () => {
    const prisma = prismaWith([row(milk.group)]);
    const service = new ProductOptionGroupsService(prisma as unknown as PrismaService);

    const groups = await service.forProduct('p-latte', { brandId: 'brand-a' });
    expect(groups[0]?.options.every((o) => o.available)).toBe(true);
    expect(prisma.storeOptionStop.findMany).not.toHaveBeenCalled();

    const empty = prismaWith([]);
    const bare = new ProductOptionGroupsService(empty as unknown as PrismaService);
    expect(await bare.forProduct('p-croissant', { brandId: 'brand-a', storeId: 'store-1' })).toEqual([]);
    expect(empty.brandOptionSetting.findMany).not.toHaveBeenCalled();
  });
});
