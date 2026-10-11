import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PosProvider } from '@prisma/client';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { POS_SYNC_QUEUE } from './pos-sync.queue';
import { PosService } from './pos.service';
import { IikoProvider } from './providers/iiko.provider';
import { PosterProvider } from './providers/poster.provider';

/** A POS spot becomes a store the owner still has to finish — not a live one at 0,0. */
describe('PosService.upsertImportedStores', () => {
  async function build(siblingZones: string[]) {
    const prisma = {
      posIntegration: {
        findUnique: jest.fn().mockResolvedValue({
          brandId: 'brand-1',
          provider: PosProvider.POSTER,
          brand: { currency: 'MDL' },
        }),
      },
      store: {
        findMany: jest.fn().mockResolvedValue(siblingZones.map((timezone) => ({ timezone }))),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'store-new' }),
        update: jest.fn(),
      },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p-latte' }]) },
      productStore: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const module = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: PrismaService, useValue: prisma },
        { provide: SecretCipher, useValue: {} },
        { provide: BrandScopeService, useValue: {} },
        { provide: IikoProvider, useValue: {} },
        { provide: PosterProvider, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: getQueueToken(POS_SYNC_QUEUE), useValue: {} },
      ],
    }).compile();
    return { service: module.get(PosService), prisma };
  }

  function createdData(prisma: Awaited<ReturnType<typeof build>>['prisma']): Record<string, unknown> {
    const args = prisma.store.create.mock.calls[0] as [{ data: Record<string, unknown> }] | undefined;
    if (!args) throw new Error('no store was created');
    return args[0].data;
  }

  it("creates the store closed, in the brand's currency and its stores' zone", async () => {
    const { service, prisma } = await build(['Europe/Chisinau']);
    await service.upsertImportedStores('int-1', [{ externalId: '7', name: 'Балка' }]);
    expect(createdData(prisma)).toMatchObject({
      status: 'CLOSED',
      currency: 'MDL',
      timezone: 'Europe/Chisinau',
      latitude: 0,
      longitude: 0,
    });
  });

  it("sells the brand's whole menu in an imported store", async () => {
    const { service, prisma } = await build(['Europe/Chisinau']);
    await service.upsertImportedStores('int-1', [{ externalId: '7', name: 'Балка' }]);
    expect(prisma.productStore.createMany).toHaveBeenCalledWith({
      data: [{ productId: 'p-latte', storeId: 'store-new' }],
      skipDuplicates: true,
    });
  });

  it('keeps a zone the POS reports, and never falls back to UTC with nothing to go on', async () => {
    const reported = await build(['Europe/Chisinau']);
    await reported.service.upsertImportedStores('int-1', [{ externalId: '7', name: 'Балка', timezone: 'Europe/Kiev' }]);
    expect(createdData(reported.prisma)['timezone']).toBe('Europe/Kiev');

    const nothing = await build([]);
    await nothing.service.upsertImportedStores('int-1', [{ externalId: '7', name: 'Балка', timezone: 'nonsense' }]);
    expect(createdData(nothing.prisma)['timezone']).toBe('Europe/Chisinau');
  });

  it("derives the zone from the spot's city before the brand's other stores", async () => {
    const { service, prisma } = await build(['Europe/London']);
    await service.upsertImportedStores('int-1', [
      { externalId: '7', name: 'Балка', city: 'Тирасполь', timezone: 'UTC' },
    ]);
    expect(createdData(prisma)['timezone']).toBe('Europe/Chisinau');
  });
});

/** A re-sync from the POS brings names and order up to date and nothing the owner decided here. */
describe('PosService.upsertImportedMenu', () => {
  it('leaves an imported category marked add-ons only (and its visibility) alone on the next sync', async () => {
    const prisma = {
      posIntegration: {
        findUnique: jest.fn().mockResolvedValue({ brandId: 'brand-1', provider: PosProvider.POSTER }),
      },
      category: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c-extras' }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
      },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p-syrup' }), update: jest.fn(), create: jest.fn() },
      store: { findMany: jest.fn().mockResolvedValue([{ id: 'store-1' }]) },
    };
    const module = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: PrismaService, useValue: prisma },
        { provide: SecretCipher, useValue: {} },
        { provide: BrandScopeService, useValue: {} },
        { provide: IikoProvider, useValue: {} },
        { provide: PosterProvider, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: getQueueToken(POS_SYNC_QUEUE), useValue: {} },
      ],
    }).compile();

    await module.get(PosService).upsertImportedMenu('int-1', {
      categories: [{ externalId: '9', name: 'Дополнительные ингредиенты', sortOrder: 9 }],
      products: [{ externalId: '41', categoryExternalId: '9', name: 'Сироп ванильный', basePriceCents: 500 }],
      modifiers: [],
    });

    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'c-extras' },
      data: { name: 'Дополнительные ингредиенты', sortOrder: 9 },
    });
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  // The POS owns names, prices and order. The kind, the default prep time and
  // the add-on groups are set in takeAway and must survive every re-sync.
  describe('kinds, prep times and add-on groups', () => {
    async function sync(existing: { id: string } | null) {
      const prisma = {
        posIntegration: {
          findUnique: jest.fn().mockResolvedValue({ brandId: 'brand-1', provider: PosProvider.POSTER }),
        },
        category: {
          findFirst: jest.fn().mockResolvedValue(existing),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({ id: 'c-new' }),
        },
        product: { findFirst: jest.fn().mockResolvedValue({ id: 'p-1' }), update: jest.fn(), create: jest.fn() },
        store: { findMany: jest.fn().mockResolvedValue([{ id: 'store-1' }]) },
        // Not touched by a menu sync at all: `group` and the category option sets live here.
        modifier: { update: jest.fn(), updateMany: jest.fn(), upsert: jest.fn(), create: jest.fn() },
        categoryOption: { updateMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
      };
      const module = await Test.createTestingModule({
        providers: [
          PosService,
          { provide: PrismaService, useValue: prisma },
          { provide: SecretCipher, useValue: {} },
          { provide: BrandScopeService, useValue: {} },
          { provide: IikoProvider, useValue: {} },
          { provide: PosterProvider, useValue: {} },
          { provide: NotificationsService, useValue: {} },
          { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
          { provide: getQueueToken(POS_SYNC_QUEUE), useValue: {} },
        ],
      }).compile();
      await module.get(PosService).upsertImportedMenu('int-1', {
        categories: [{ externalId: '3', name: 'Шаурма', sortOrder: 3 }],
        products: [{ externalId: '41', categoryExternalId: '3', name: 'Шаурма классическая', basePriceCents: 9000 }],
        modifiers: [],
      });
      return prisma;
    }

    it('never writes the kind or the default prep time of a category it already has', async () => {
      const prisma = await sync({ id: 'c-shawarma' });

      const data = (prisma.category.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(Object.keys(data).sort()).toEqual(['name', 'sortOrder']);
    });

    it('guesses the kind of a category it creates from the POS name, and sets no prep time', async () => {
      const prisma = await sync(null);

      const data = (prisma.category.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(data['kind']).toBe('FOOD');
      expect(data).not.toHaveProperty('defaultPrepTimeSeconds');
    });

    it('leaves add-on groups and category option sets alone', async () => {
      const prisma = await sync({ id: 'c-shawarma' });

      for (const fn of [...Object.values(prisma.modifier), ...Object.values(prisma.categoryOption)]) {
        expect(fn).not.toHaveBeenCalled();
      }
      const product = (prisma.product.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(product).not.toHaveProperty('modifiers');
    });
  });
});
