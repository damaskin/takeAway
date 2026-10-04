import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminIngredientsController } from './admin-ingredients.controller';
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
    ingredient: {
      findUnique: jest.fn().mockResolvedValue({ brandId: 'brand-1' }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ing-oat',
          name: 'Овсяное молоко',
          isAvailable: true,
          storeStops: [{ expiresAt: null }],
          modifiers: [],
          variations: [
            { product: { name: 'Латте' } },
            { product: { name: 'Капучино' } },
            { product: { name: 'Латте' } },
          ],
        },
      ]),
    },
    storeIngredientStop: {
      upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => Promise.resolve(create)),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { prisma, svc: new StoreAvailabilityService(prisma as unknown as PrismaService) };
}

describe('StoreAvailabilityService', () => {
  it("lists the store's products and add-ins with what is stopped there", async () => {
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
      ingredients: [
        {
          id: 'ing-oat',
          name: 'Овсяное молоко',
          isAvailable: true,
          stop: { expiresAt: null },
          productNames: ['Капучино', 'Латте'],
        },
      ],
    });
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

  it('stops an ingredient in this store only, until the time given', async () => {
    const { svc, prisma } = build();
    const until = new Date('2026-10-04T21:00:00Z');

    await svc.stopIngredient('pizza', 'ing-oat', { expiresAt: until }, ['brand-1']);

    expect(prisma.storeIngredientStop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId_ingredientId: { storeId: 'pizza', ingredientId: 'ing-oat' } },
        create: { storeId: 'pizza', ingredientId: 'ing-oat', expiresAt: until },
      }),
    );
  });

  it("refuses another brand's ingredient as if it did not exist", async () => {
    const { svc, prisma } = build();
    prisma.ingredient.findUnique.mockResolvedValue({ brandId: 'brand-2' });

    await expect(svc.stopIngredient('pizza', 'ing-x', {}, ['brand-1'])).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.storeIngredientStop.upsert).not.toHaveBeenCalled();
  });

  it('lifts a stop, quietly when there was none', async () => {
    const { svc, prisma } = build();
    prisma.storeIngredientStop.deleteMany.mockResolvedValue({ count: 0 });

    await expect(svc.resumeIngredient('pizza', 'ing-oat', ['brand-1'])).resolves.toBeUndefined();
    expect(prisma.storeIngredientStop.deleteMany).toHaveBeenCalledWith({
      where: { storeId: 'pizza', ingredientId: 'ing-oat' },
    });
  });
});

/**
 * Kitchen staff run the stop-list: they switch products and add-ins off and
 * on for their store. Making, changing and deleting the menu is not theirs.
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

  it.each([
    'listStopList',
    'addStopListEntry',
    'removeStopListEntry',
    'getAvailability',
    'stopIngredient',
    'resumeIngredient',
  ])('can toggle availability: %s', (method) => {
    expect(rolesOf(AdminStoresController, method)).toContain(Role.STAFF);
  });

  it.each([
    [AdminProductsController, 'create'],
    [AdminProductsController, 'update'],
    [AdminProductsController, 'delete'],
    [AdminProductsController, 'toggleVisibility'],
    [AdminProductsController, 'createModifier'],
    [AdminProductsController, 'deleteModifier'],
    [AdminProductsController, 'createVariation'],
    [AdminProductsController, 'deleteVariation'],
    [AdminIngredientsController, 'create'],
    [AdminIngredientsController, 'update'],
    [AdminIngredientsController, 'delete'],
    [AdminCategoriesController, 'create'],
    [AdminCategoriesController, 'delete'],
    [AdminStoresController, 'create'],
    [AdminStoresController, 'delete'],
  ] as const)('cannot change the menu itself: %p.%s', (controller, method) => {
    expect(rolesOf(controller, method)).not.toContain(Role.STAFF);
  });
});
