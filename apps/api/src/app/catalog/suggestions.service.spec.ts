import { NotFoundException } from '@nestjs/common';
import type { CategoryKind } from '@prisma/client';

import { COUNTED } from '../analytics/analytics-sql';
import { MemoryRedis } from '../auth/services/testing/memory-redis';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { CatalogService } from './catalog.service';
import type { CoPurchaseRow } from './copurchase';
import type { MenuDto } from './dto/product.dto';
import { SUGGESTIONS_CACHE_SECONDS, SuggestionsService } from './suggestions.service';

function category(kind: CategoryKind, products: Array<[string, boolean?]>) {
  return {
    id: kind,
    kind,
    products: products.map(([id, onStopList = false]) => ({ id, onStopList, categoryKind: kind })),
  };
}

/** Two drinks, the bakery with a cookie sold out, and a sandwich. */
const MENU = {
  storeId: 'store-1',
  storeSlug: 'centre',
  categories: [
    category('HOT_DRINKS', [['latte'], ['americano']]),
    category('BAKERY', [['croissant'], ['cookie', true], ['muffin']]),
    category('FOOD', [['sandwich']]),
  ],
} as unknown as MenuDto;

const baskets = (here: number, brand = here): CoPurchaseRow => ({ productId: null, here, brand });
const row = (productId: string, here: number, brand = here): CoPurchaseRow => ({ productId, here, brand });

describe('SuggestionsService', () => {
  let prisma: { store: { findFirst: jest.Mock }; $queryRaw: jest.Mock };
  let catalog: { getMenu: jest.Mock };
  let redis: MemoryRedis;
  let service: SuggestionsService;

  beforeEach(() => {
    prisma = {
      store: { findFirst: jest.fn().mockResolvedValue({ id: 'store-1', brandId: 'brand-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    catalog = { getMenu: jest.fn().mockResolvedValue(MENU) };
    redis = new MemoryRedis();
    service = new SuggestionsService(
      prisma as unknown as PrismaService,
      redis.asService(),
      catalog as unknown as CatalogService,
    );
  });

  it('offers what customers bought together with the products in hand, most often first', async () => {
    prisma.$queryRaw.mockResolvedValue([
      baskets(42),
      row('croissant', 12),
      row('cookie', 30),
      row('americano', 9),
      row('sandwich', 15),
      row('salad-gone', 20),
    ]);
    await expect(service.suggest('centre', ['latte'])).resolves.toEqual({
      productIds: ['sandwich', 'croissant', 'americano'],
      source: 'copurchase',
    });
    expect(catalog.getMenu).toHaveBeenCalledWith('store-1');
  });

  it('counts the baskets of the products in hand, at this store and across its brand', async () => {
    await service.suggest('centre', ['latte', 'americano', 'latte']);
    const [, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(values).toEqual(expect.arrayContaining(['store-1', 'brand-1', COUNTED, ['americano', 'latte']]));
    expect(prisma.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ id: 'centre' }, { slug: 'centre' }], brand: { moderationStatus: 'APPROVED' } },
      }),
    );
  });

  it('keeps to the limit', async () => {
    prisma.$queryRaw.mockResolvedValue([baskets(42), row('croissant', 12), row('sandwich', 15), row('muffin', 4)]);
    await expect(service.suggest('centre', ['latte'], 2)).resolves.toEqual({
      productIds: ['sandwich', 'croissant'],
      source: 'copurchase',
    });
  });

  it('falls back to bakery and food next to a drink while there are too few orders', async () => {
    prisma.$queryRaw.mockResolvedValue([baskets(19, 19), row('americano', 19)]);
    await expect(service.suggest('centre', ['latte'])).resolves.toEqual({
      productIds: ['croissant', 'sandwich', 'muffin'],
      source: 'rule',
    });
  });

  it('offers nothing by the rule next to something to eat, or with nothing in hand', async () => {
    await expect(service.suggest('centre', ['latte', 'croissant'])).resolves.toEqual({
      productIds: [],
      source: 'rule',
    });
    await expect(service.suggest('centre', [])).resolves.toEqual({ productIds: [], source: 'rule' });
    // Nothing in hand needs no counting at all.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to the rule when everything bought together is sold out or off the menu', async () => {
    prisma.$queryRaw.mockResolvedValue([baskets(42), row('cookie', 30), row('salad-gone', 20)]);
    await expect(service.suggest('centre', ['latte'])).resolves.toMatchObject({ source: 'rule' });
  });

  it('remembers the counts for ten minutes per set of products, in any order, and reads the menu each time', async () => {
    prisma.$queryRaw.mockResolvedValue([baskets(42), row('croissant', 12)]);
    await service.suggest('centre', ['latte', 'americano']);
    await service.suggest('centre', ['americano', 'latte']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(catalog.getMenu).toHaveBeenCalledTimes(2);

    // Sold out meanwhile: gone at once, though the counts are cached.
    catalog.getMenu.mockResolvedValue({
      ...MENU,
      categories: MENU.categories.map((c) => ({
        ...c,
        products: c.products.map((p) => (p.id === 'croissant' ? { ...p, onStopList: true } : p)),
      })),
    });
    await expect(service.suggest('centre', ['latte', 'americano'])).resolves.toMatchObject({ source: 'rule' });

    redis.advance(SUGGESTIONS_CACHE_SECONDS + 1);
    await service.suggest('centre', ['latte', 'americano']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('remembers too little data too, so a quiet store is not counted on every request', async () => {
    prisma.$queryRaw.mockResolvedValue([baskets(3)]);
    await service.suggest('centre', ['latte']);
    await service.suggest('centre', ['latte']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('still answers when Redis is down', async () => {
    const broken = {
      get: jest.fn().mockRejectedValue(new Error('down')),
      set: jest.fn().mockRejectedValue(new Error('down')),
    } as unknown as RedisService;
    service = new SuggestionsService(prisma as unknown as PrismaService, broken, catalog as unknown as CatalogService);
    prisma.$queryRaw.mockResolvedValue([baskets(42), row('croissant', 12)]);
    await expect(service.suggest('centre', ['latte'])).resolves.toEqual({
      productIds: ['croissant'],
      source: 'copurchase',
    });
  });

  it('throws 404 for a store it does not know', async () => {
    prisma.store.findFirst.mockResolvedValue(null);
    await expect(service.suggest('nowhere', ['latte'])).rejects.toBeInstanceOf(NotFoundException);
  });
});
