import { Role } from '@prisma/client';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminProductsController } from './admin-products.controller';
import { AdminStoresController } from './admin-stores.controller';
import { StoreAvailabilityService } from './store-availability.service';

function build() {
  const prisma = {
    store: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pizza',
        name: 'Пиццерия',
        brandId: 'brand-1',
        timezone: 'Europe/Chisinau',
      }),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'p-margherita',
          name: 'Маргарита',
          categoryId: 'c-pizza',
          imageUrls: ['https://cdn/m.jpg'],
          category: { name: 'Пицца' },
          stopListEntries: [{ expiresAt: new Date('2026-10-04T21:00:00Z') }],
        },
        {
          id: 'p-latte',
          name: 'Латте',
          categoryId: 'c-coffee',
          imageUrls: [],
          category: { name: 'Кофе' },
          stopListEntries: [],
        },
      ]),
    },
    optionItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'oi_ice_ice',
          name: 'Лёд',
          note: null,
          group: {
            id: 'og_ice',
            name: 'Лёд',
            products: [{ product: { name: 'Латте' } }, { product: { name: 'Американо' } }],
          },
          storeStops: [{ expiresAt: new Date('2026-10-04T21:00:00Z') }],
        },
      ]),
    },
  };
  return { prisma, svc: new StoreAvailabilityService(prisma as unknown as PrismaService) };
}

describe('StoreAvailabilityService', () => {
  it("lists the store's products and catalog options with what is stopped there", async () => {
    const { svc, prisma } = build();

    const view = await svc.get('pizza', ['brand-1']);

    expect(view).toEqual({
      storeId: 'pizza',
      storeName: 'Пиццерия',
      timezone: 'Europe/Chisinau',
      products: [
        {
          id: 'p-margherita',
          name: 'Маргарита',
          categoryId: 'c-pizza',
          categoryName: 'Пицца',
          imageUrl: 'https://cdn/m.jpg',
          stop: { expiresAt: '2026-10-04T21:00:00.000Z' },
        },
        { id: 'p-latte', name: 'Латте', categoryId: 'c-coffee', categoryName: 'Кофе', imageUrl: null, stop: null },
      ],
      options: [
        {
          id: 'oi_ice_ice',
          name: 'Лёд',
          note: null,
          groupId: 'og_ice',
          groupName: 'Лёд',
          stop: { expiresAt: '2026-10-04T21:00:00.000Z' },
          productNames: ['Американо', 'Латте'],
        },
      ],
    });
    // Catalog options of the groups on what this store sells, without those the brand switched off.
    expect(prisma.optionItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          group: { products: { some: { product: { stores: { some: { storeId: 'pizza' } } } } } },
          brandSettings: { none: { brandId: 'brand-1', enabled: false } },
        },
      }),
    );
    // Only what this store sells.
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { brandId: 'brand-1', visible: true, stores: { some: { storeId: 'pizza' } } },
      }),
    );
  });

  it('refuses a store of another brand', async () => {
    const { svc } = build();
    await expect(svc.get('pizza', ['brand-2'])).rejects.toThrow('Resource belongs to a brand outside your scope');
  });
});

/**
 * Kitchen staff run the stop-list: they switch products and catalog options
 * off and on for their store (options: `AdminStoreOptionStopsController`).
 * Making, changing and deleting the menu is not theirs.
 */
describe('STAFF on the menu', () => {
  type Handler = (...args: never[]) => unknown;
  function rolesOf(controller: { prototype: object }, method: string): Role[] {
    const handler = (controller.prototype as Record<string, Handler>)[method];
    if (!handler) throw new Error(`no handler ${method}`);
    return (
      (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined) ??
      (Reflect.getMetadata(ROLES_KEY, controller) as Role[])
    );
  }

  it.each(['listStopList', 'addStopListEntry', 'removeStopListEntry', 'getAvailability'])(
    'can toggle availability: %s',
    (method) => {
      expect(rolesOf(AdminStoresController, method)).toContain(Role.STAFF);
    },
  );

  it.each([
    [AdminProductsController, 'create'],
    [AdminProductsController, 'update'],
    [AdminProductsController, 'delete'],
    [AdminProductsController, 'toggleVisibility'],
    [AdminCategoriesController, 'create'],
    [AdminCategoriesController, 'delete'],
    [AdminStoresController, 'create'],
    [AdminStoresController, 'delete'],
  ] as const)('cannot change the menu itself: %p.%s', (controller, method) => {
    expect(rolesOf(controller, method)).not.toContain(Role.STAFF);
  });
});
