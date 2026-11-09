import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { KDS_SESSION_KEY } from '../../auth/decorators/kds-session.decorator';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminProductsController } from '../catalog/admin-products.controller';
import { AdminStoresController } from '../catalog/admin-stores.controller';
import {
  AdminBrandOptionsController,
  AdminProductOptionGroupsController,
  AdminStoreOptionStopsController,
} from './admin-brand-options.controller';
import { AdminBrandOptionsService } from './admin-brand-options.service';
import { AdminLegacyOptionsService } from './admin-legacy-options.service';
import { AdminOptionGroupsController, AdminOptionItemsController } from './admin-option-catalog.controller';
import { AdminOptionCatalogService } from './admin-option-catalog.service';
import { AdminProductOptionGroupsService } from './admin-product-option-groups.service';
import { groupProblem, qtyProblem } from './option-catalog.rules';

/** The HTTP status and body of a rejected call. */
async function rejection(pending: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const err = (await pending.then(
    () => null,
    (e: unknown) => e,
  )) as { getStatus?: () => number; getResponse?: () => unknown } | null;
  if (!err?.getStatus || !err.getResponse) throw new Error(`expected an HTTP error, got ${String(err)}`);
  const body = err.getResponse();
  return { status: err.getStatus(), body: typeof body === 'object' && body ? (body as Record<string, unknown>) : {} };
}

const prismaError = (code: string) => Object.assign(new Error(code), { code });

const groupRow = (patch: Record<string, unknown> = {}) => ({
  id: 'og_syrups',
  kind: 'ADDON',
  type: 'A',
  name: 'Сиропы',
  minSelect: 0,
  maxSelect: 2,
  showIfOptionId: null,
  sortOrder: 60,
  createdAt: new Date(),
  updatedAt: new Date(),
  options: [],
  ...patch,
});

const optionRow = (patch: Record<string, unknown> = {}) => ({
  id: 'oi_sugar',
  groupId: 'og_sugar',
  name: 'Сахар',
  note: null,
  isDefault: false,
  minQty: 0,
  maxQty: 3,
  defaultQty: 0,
  sortOrder: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...patch,
});

describe('catalog write rules', () => {
  it.each([
    [{ kind: 'ADDON', type: 'D', minSelect: null, maxSelect: null }, 'reserved'],
    [{ kind: 'VARIANT', type: 'C', minSelect: null, maxSelect: null }, 'counter'],
    [{ kind: 'ADDON', type: 'B', minSelect: 0, maxSelect: null }, 'Only a type A'],
    [{ kind: 'ADDON', type: 'C', minSelect: null, maxSelect: 2 }, 'Only a type A'],
    [{ kind: 'ADDON', type: 'A', minSelect: null, maxSelect: 0 }, 'at least 1'],
    [{ kind: 'ADDON', type: 'A', minSelect: 3, maxSelect: 2 }, 'above'],
  ] as const)('refuses %o', (shape, why) => {
    expect(groupProblem(shape)).toContain(why);
  });

  it.each([
    { kind: 'VARIANT', type: 'A', minSelect: 1, maxSelect: 1 },
    { kind: 'ADDON', type: 'A', minSelect: null, maxSelect: null },
    { kind: 'VARIANT', type: 'B', minSelect: null, maxSelect: null },
    { kind: 'ADDON', type: 'C', minSelect: null, maxSelect: null },
  ] as const)('accepts %o', (shape) => {
    expect(groupProblem(shape)).toBeNull();
  });

  it('wants 0 ≤ minQty ≤ defaultQty ≤ maxQty ≤ 20 on a counter, nulls read as 0 / 0 / 20', () => {
    expect(qtyProblem({ minQty: 1, maxQty: 2, defaultQty: 1 })).toBeNull(); // meat
    expect(qtyProblem({ minQty: null, maxQty: null, defaultQty: null })).toBeNull();
    expect(qtyProblem({ minQty: 1, maxQty: 2, defaultQty: null })).not.toBeNull(); // default reads as 0 < min
    expect(qtyProblem({ minQty: 0, maxQty: 2, defaultQty: 3 })).not.toBeNull();
    expect(qtyProblem({ minQty: -1, maxQty: 2, defaultQty: 0 })).not.toBeNull();
    expect(qtyProblem({ minQty: 0, maxQty: 21, defaultQty: 0 })).not.toBeNull();
  });
});

describe('AdminOptionCatalogService', () => {
  function build() {
    const prisma = {
      optionGroup: {
        findMany: jest.fn().mockResolvedValue([{ ...groupRow(), _count: { products: 4 } }]),
        findUnique: jest.fn(),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(groupRow(data))),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...groupRow(data), _count: { products: 0 } }),
        ),
        delete: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 290 } }),
      },
      optionItem: {
        findUnique: jest.fn(),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(optionRow(data))),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(optionRow(data))),
        delete: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      },
    };
    return { prisma, service: new AdminOptionCatalogService(prisma as unknown as PrismaService) };
  }

  it('lists the catalog with how many products use each group', async () => {
    const { service } = build();
    expect(await service.list()).toEqual([expect.objectContaining({ id: 'og_syrups', productCount: 4, options: [] })]);
  });

  it('creates a group after the last one, and refuses a reserved type or a variant counter', async () => {
    const { prisma, service } = build();
    await service.createGroup({ kind: 'ADDON', type: 'B', name: 'Топпинги' });
    expect(prisma.optionGroup.create.mock.calls[0]?.[0].data).toEqual({
      kind: 'ADDON',
      type: 'B',
      minSelect: null,
      maxSelect: null,
      name: 'Топпинги',
      showIfOptionId: null,
      sortOrder: 300,
    });

    for (const bad of [
      { kind: 'ADDON', type: 'D' },
      { kind: 'VARIANT', type: 'C' },
      { kind: 'ADDON', type: 'B', maxSelect: 2 },
    ] as const) {
      const err = await rejection(service.createGroup({ name: 'X', ...bad }));
      expect(err).toMatchObject({ status: 400, body: { code: 'OPTION_GROUP_INVALID' } });
    }
  });

  it('answers 409 OPTION_NAME_TAKEN for a taken group or option name', async () => {
    const { prisma, service } = build();
    prisma.optionGroup.create.mockRejectedValueOnce(prismaError('P2002'));
    expect(await rejection(service.createGroup({ kind: 'ADDON', type: 'A', name: 'Сиропы' }))).toMatchObject({
      status: 409,
      body: { code: 'OPTION_NAME_TAKEN', name: 'Сиропы' },
    });

    prisma.optionGroup.findUnique.mockResolvedValue({ type: 'A' });
    prisma.optionItem.create.mockRejectedValueOnce(prismaError('P2002'));
    expect(await rejection(service.createOption('og_syrups', { name: 'Ваниль' }))).toMatchObject({
      status: 409,
      body: { code: 'OPTION_NAME_TAKEN' },
    });
  });

  it('refuses a condition on an option of the group itself, or on one that does not exist', async () => {
    const { prisma, service } = build();
    prisma.optionGroup.findUnique.mockResolvedValue(groupRow({ id: 'og_serving' }));
    prisma.optionItem.findUnique.mockResolvedValueOnce({ groupId: 'og_serving' });
    expect(await rejection(service.updateGroup('og_serving', { showIfOptionId: 'oi_cold' }))).toMatchObject({
      status: 400,
      body: { code: 'OPTION_GROUP_INVALID' },
    });

    prisma.optionItem.findUnique.mockResolvedValueOnce(null);
    expect(
      await rejection(service.createGroup({ kind: 'ADDON', type: 'C', name: 'Лёд', showIfOptionId: 'ghost' })),
    ).toMatchObject({ status: 400, body: { code: 'OPTION_GROUP_INVALID' } });
  });

  it('drops min/max when a list becomes a switch, and checks the counters when it becomes one', async () => {
    const { prisma, service } = build();
    prisma.optionGroup.findUnique.mockResolvedValue(groupRow());
    await service.updateGroup('og_syrups', { type: 'B' });
    expect(prisma.optionGroup.update.mock.calls[0]?.[0].data).toMatchObject({
      type: 'B',
      minSelect: null,
      maxSelect: null,
    });

    prisma.optionGroup.findUnique.mockResolvedValue(
      groupRow({ options: [optionRow({ minQty: 2, maxQty: 3, defaultQty: 1 })] }),
    );
    expect(await rejection(service.updateGroup('og_syrups', { type: 'C' }))).toMatchObject({
      status: 400,
      body: { code: 'OPTION_GROUP_INVALID' },
    });
  });

  it('refuses to delete a group a product has (409 OPTION_GROUP_IN_USE)', async () => {
    const { prisma, service } = build();
    prisma.optionGroup.findUnique.mockResolvedValue({ name: 'Сиропы', _count: { products: 3 } });
    expect(await rejection(service.deleteGroup('og_syrups'))).toMatchObject({
      status: 409,
      body: { code: 'OPTION_GROUP_IN_USE', productCount: 3 },
    });
    expect(prisma.optionGroup.delete).not.toHaveBeenCalled();

    prisma.optionGroup.findUnique.mockResolvedValue({ name: 'Топпинги', _count: { products: 0 } });
    await service.deleteGroup('og_new');
    expect(prisma.optionGroup.delete).toHaveBeenCalledWith({ where: { id: 'og_new' } });
  });

  it("checks a counter's bounds, keeps fields left out, and stores no bounds on a list option", async () => {
    const { prisma, service } = build();
    prisma.optionGroup.findUnique.mockResolvedValue({ type: 'C' });
    expect(
      await rejection(service.createOption('og_meat', { name: 'Мясо', minQty: 1, maxQty: 2, defaultQty: 3 })),
    ).toMatchObject({ status: 400, body: { code: 'OPTION_GROUP_INVALID' } });

    await service.createOption('og_meat', { name: 'Мясо', minQty: 1, maxQty: 2, defaultQty: 1 });
    expect(prisma.optionItem.create.mock.calls[0]?.[0].data).toMatchObject({
      minQty: 1,
      maxQty: 2,
      defaultQty: 1,
      sortOrder: 10,
    });

    prisma.optionItem.findUnique.mockResolvedValue({ ...optionRow(), group: { type: 'C' } });
    expect(await rejection(service.updateOption('oi_sugar', { maxQty: 25 }))).toMatchObject({
      status: 400,
      body: { code: 'OPTION_GROUP_INVALID' },
    });
    await service.updateOption('oi_sugar', { maxQty: 5 });
    expect(prisma.optionItem.update.mock.calls[0]?.[0].data).toEqual({ minQty: 0, maxQty: 5, defaultQty: 0 });

    prisma.optionGroup.findUnique.mockResolvedValue({ type: 'A' });
    await service.createOption('og_syrups', { name: 'Ваниль', minQty: 1, maxQty: 2 });
    expect(prisma.optionItem.create.mock.calls[1]?.[0].data).toMatchObject({
      minQty: null,
      maxQty: null,
      defaultQty: null,
    });
  });

  it('answers 404 for an option or group that is not there', async () => {
    const { prisma, service } = build();
    prisma.optionItem.delete.mockRejectedValueOnce(prismaError('P2025'));
    await expect(service.deleteOption('ghost')).rejects.toBeInstanceOf(NotFoundException);
    prisma.optionGroup.findUnique.mockResolvedValue(null);
    await expect(service.updateGroup('ghost', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminProductOptionGroupsService', () => {
  const CATALOG = [
    { id: 'og_coffee_size', kind: 'VARIANT', type: 'A', options: [{ id: 'oi_m' }, { id: 'oi_l' }] },
    { id: 'og_milk', kind: 'ADDON', type: 'A', options: [{ id: 'oi_oat' }] },
  ];

  function build() {
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ brandId: 'brand-a' }) },
      optionGroup: {
        // Only the groups asked for, as the database would answer.
        findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(CATALOG.filter((g) => where.id.in.includes(g.id))),
        ),
      },
      productOptionGroup: {
        deleteMany: jest.fn().mockReturnValue('delete-groups'),
        createMany: jest.fn().mockReturnValue('create-groups'),
        findMany: jest.fn().mockResolvedValue([{ groupId: 'og_coffee_size', sortOrder: 0 }]),
      },
      productOptionOverride: {
        deleteMany: jest.fn().mockReturnValue('delete-overrides'),
        createMany: jest.fn().mockReturnValue('create-overrides'),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { prisma, service: new AdminProductOptionGroupsService(prisma as unknown as PrismaService) };
  }

  const groups = [
    { groupId: 'og_coffee_size', sortOrder: 0 },
    { groupId: 'og_milk', sortOrder: 1 },
  ];

  it('replaces the groups and overrides in one transaction, dropping empty overrides', async () => {
    const { prisma, service } = build();
    await service.replace(['brand-a'], 'p-latte', {
      groups,
      overrides: [
        { optionId: 'oi_l', priceCents: 1000, isDefault: null },
        { optionId: 'oi_oat', priceCents: null, isDefault: true },
        { optionId: 'oi_m', priceCents: null, isDefault: null },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledWith([
      'delete-groups',
      'delete-overrides',
      'create-groups',
      'create-overrides',
    ]);
    expect(prisma.productOptionGroup.createMany).toHaveBeenCalledWith({
      data: [
        { productId: 'p-latte', groupId: 'og_coffee_size', sortOrder: 0 },
        { productId: 'p-latte', groupId: 'og_milk', sortOrder: 1 },
      ],
    });
    expect(prisma.productOptionOverride.createMany).toHaveBeenCalledWith({
      data: [
        { productId: 'p-latte', optionId: 'oi_l', priceCents: 1000, isDefault: null },
        { productId: 'p-latte', optionId: 'oi_oat', priceCents: null, isDefault: true },
      ],
    });
  });

  it.each([
    [
      'an override outside the groups',
      { groups: groups.slice(0, 1), overrides: [{ optionId: 'oi_oat', priceCents: null, isDefault: true }] },
      'OPTION_NOT_ON_PRODUCT',
    ],
    [
      'a price on an add-on',
      { groups, overrides: [{ optionId: 'oi_oat', priceCents: 500, isDefault: null }] },
      'OPTION_GROUP_INVALID',
    ],
    ['a group listed twice', { groups: [...groups, groups[0]!], overrides: [] }, 'OPTION_GROUP_INVALID'],
    ['an unknown group', { groups: [{ groupId: 'og_ghost', sortOrder: 0 }], overrides: [] }, 'OPTION_GROUP_INVALID'],
  ])('refuses %s', async (_what, dto, code) => {
    const { prisma, service } = build();
    expect(await rejection(service.replace(['brand-a'], 'p-latte', dto))).toMatchObject({
      status: 400,
      body: { code },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a type D group and a product of another brand', async () => {
    const { prisma, service } = build();
    prisma.optionGroup.findMany.mockResolvedValueOnce([{ id: 'og_d', kind: 'ADDON', type: 'D', options: [] }]);
    expect(
      await rejection(
        service.replace(['brand-a'], 'p-latte', { groups: [{ groupId: 'og_d', sortOrder: 0 }], overrides: [] }),
      ),
    ).toMatchObject({ status: 400, body: { code: 'OPTION_GROUP_INVALID' } });

    await expect(service.get(['brand-b'], 'p-latte')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AdminBrandOptionsService', () => {
  function build() {
    const prisma = {
      brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-a' }) },
      store: { findUnique: jest.fn().mockResolvedValue({ id: 'store-1', brandId: 'brand-a' }) },
      optionGroup: {
        findMany: jest.fn().mockResolvedValue([
          groupRow({
            options: [
              optionRow({ id: 'oi_vanilla', groupId: 'og_syrups' }),
              optionRow({ id: 'oi_caramel', groupId: 'og_syrups' }),
            ],
          }),
        ]),
      },
      optionItem: { findUnique: jest.fn().mockResolvedValue({ id: 'oi_vanilla' }) },
      brandOptionSetting: {
        findMany: jest.fn().mockResolvedValue([{ optionId: 'oi_vanilla', priceCents: 800, enabled: false }]),
        upsert: jest.fn().mockResolvedValue({ optionId: 'oi_vanilla', priceCents: 900, enabled: true }),
      },
      storeOptionStop: {
        findMany: jest.fn().mockResolvedValue([
          { storeId: 'store-2', optionId: 'oi_caramel' },
          { storeId: 'store-1', optionId: 'oi_caramel' },
        ]),
        upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => Promise.resolve(create)),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    return { prisma, service: new AdminBrandOptionsService(prisma as unknown as PrismaService) };
  }

  it("gives every catalog option the brand's price and switch (no row = on at 0) and its stopped stores", async () => {
    const { service } = build();
    const catalog = await service.catalog(['brand-a'], 'brand-a');

    expect(catalog.groups.map((g) => g.id)).toEqual(['og_syrups']);
    expect(catalog.settings).toEqual([
      { optionId: 'oi_vanilla', priceCents: 800, enabled: false, stoppedStoreIds: [] },
      { optionId: 'oi_caramel', priceCents: 0, enabled: true, stoppedStoreIds: ['store-1', 'store-2'] },
    ]);
  });

  it("sets a brand's price, and keeps out of another brand", async () => {
    const { prisma, service } = build();
    await service.update(['brand-a'], 'brand-a', 'oi_vanilla', { priceCents: 900 });
    expect(prisma.brandOptionSetting.upsert).toHaveBeenCalledWith({
      where: { brandId_optionId: { brandId: 'brand-a', optionId: 'oi_vanilla' } },
      create: { brandId: 'brand-a', optionId: 'oi_vanilla', priceCents: 900, enabled: true },
      update: { priceCents: 900 },
    });

    await expect(service.update(['brand-b'], 'brand-a', 'oi_vanilla', { enabled: false })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.catalog(['brand-b'], 'brand-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stops an option in a store until switched on, and lifts it; never in a store of another brand', async () => {
    const { prisma, service } = build();
    expect(await service.stop(null, 'store-1', 'oi_vanilla', {})).toEqual({
      storeId: 'store-1',
      optionId: 'oi_vanilla',
      expiresAt: null,
    });
    await service.resume(['brand-a'], 'store-1', 'oi_vanilla');
    expect(prisma.storeOptionStop.deleteMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', optionId: 'oi_vanilla' },
    });

    await expect(service.stop(['brand-b'], 'store-1', 'oi_vanilla', {})).rejects.toBeInstanceOf(ForbiddenException);
    prisma.optionItem.findUnique.mockResolvedValueOnce(null);
    await expect(service.stop(['brand-a'], 'store-1', 'ghost', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminLegacyOptionsService', () => {
  function build() {
    const tx = {
      product: { count: jest.fn().mockResolvedValue(2) },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ci-size', cartId: 'cart-1', variationIds: ['v-l'], modifiersJson: {} },
          { id: 'ci-extra', cartId: 'cart-2', variationIds: [], modifiersJson: { 'm-shot': 1 } },
          { id: 'ci-catalog', cartId: 'cart-1', variationIds: [], modifiersJson: {} },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      cart: { update: jest.fn().mockResolvedValue({}) },
      categoryOption: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
      modifier: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      variation: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
      storeIngredientStop: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ingredient: { deleteMany: jest.fn().mockResolvedValue({ count: 6 }) },
    };
    const prisma = {
      brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-a' }) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    return { tx, prisma, service: new AdminLegacyOptionsService(prisma as unknown as PrismaService) };
  }

  it("clears the brand's older options in one transaction and answers what went", async () => {
    const { tx, prisma, service } = build();
    // Re-totalling reads what is left in each cart.
    tx.cartItem.findMany
      .mockResolvedValueOnce([
        { id: 'ci-size', cartId: 'cart-1', variationIds: ['v-l'], modifiersJson: {} },
        { id: 'ci-extra', cartId: 'cart-2', variationIds: [], modifiersJson: { 'm-shot': 1 } },
        { id: 'ci-catalog', cartId: 'cart-1', variationIds: [], modifiersJson: {} },
      ])
      .mockResolvedValue([{ unitPriceCents: 7100, quantity: 1 }]);

    expect(await service.clear('brand-a')).toEqual({
      products: 2,
      variations: 5,
      modifiers: 3,
      categoryOptions: 4,
      ingredients: 6,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Only the lines made with older options leave the carts.
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-size', 'ci-extra'] } } });
    expect(tx.variation.deleteMany).toHaveBeenCalledWith({ where: { product: { brandId: 'brand-a' } } });
    expect(tx.ingredient.deleteMany).toHaveBeenCalledWith({ where: { brandId: 'brand-a' } });
    expect(tx.storeIngredientStop.deleteMany).toHaveBeenCalledWith({ where: { ingredient: { brandId: 'brand-a' } } });
  });

  it('answers 404 for a brand that is not there', async () => {
    const { prisma, service } = build();
    prisma.brand.findUnique.mockResolvedValue(null);
    await expect(service.clear('ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('options catalog roles', () => {
  function rolesOf(controller: abstract new (...args: never[]) => unknown, method: string): Role[] {
    const handler = (controller.prototype as Record<string, unknown>)[method] as object;
    return (
      (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined) ??
      (Reflect.getMetadata(ROLES_KEY, controller) as Role[])
    );
  }

  it('keeps the catalog and the legacy clear to the takeAway team', () => {
    for (const method of ['list', 'create', 'update', 'delete', 'createOption']) {
      expect(rolesOf(AdminOptionGroupsController, method)).toEqual([Role.SUPER_ADMIN]);
    }
    for (const method of ['update', 'delete']) {
      expect(rolesOf(AdminOptionItemsController, method)).toEqual([Role.SUPER_ADMIN]);
    }
    expect(rolesOf(AdminBrandOptionsController, 'legacySummary')).toEqual([Role.SUPER_ADMIN]);
    expect(rolesOf(AdminBrandOptionsController, 'clearLegacy')).toEqual([Role.SUPER_ADMIN]);
  });

  it('gives brand settings to the roles of the add-ons library', () => {
    expect(rolesOf(AdminBrandOptionsController, 'catalog')).toEqual([
      Role.SUPER_ADMIN,
      Role.BRAND_ADMIN,
      Role.STORE_MANAGER,
      Role.MENU_EDITOR,
    ]);
    expect(rolesOf(AdminBrandOptionsController, 'update')).toEqual(rolesOf(AdminBrandOptionsController, 'catalog'));
  });

  it('mirrors the store ingredient stops and the product editor', () => {
    for (const method of ['stop', 'resume']) {
      expect(rolesOf(AdminStoreOptionStopsController, method)).toEqual(
        rolesOf(AdminStoresController, 'stopIngredient'),
      );
      const handler = (AdminStoreOptionStopsController.prototype as unknown as Record<string, object>)[method]!;
      expect(Reflect.getMetadata(KDS_SESSION_KEY, handler)).toEqual({ from: 'param', key: 'storeId' });
    }
    for (const method of ['get', 'replace']) {
      expect(rolesOf(AdminProductOptionGroupsController, method)).toEqual(rolesOf(AdminProductsController, 'update'));
    }
  });
});
