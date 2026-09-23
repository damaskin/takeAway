import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { FeatureFlagsService } from '../config/feature-flags.service';
import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

function storeFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'store-1',
    slug: 'dubai-marina',
    name: 'takeAway Marina',
    addressLine: 'Marina Walk',
    city: 'Dubai',
    country: 'AE',
    latitude: 25.078,
    longitude: 55.141,
    status: 'OPEN',
    fulfillmentTypes: ['TAKEAWAY'],
    pickupPointType: 'SHELF',
    busyMeter: 35,
    baseEtaSeconds: 360,
    kitchenParallelism: 2,
    slotCapacity: 8,
    taxRateBps: 0,
    taxIncludedInPrice: true,
    currency: 'AED',
    heroImageUrl: null,
    timezone: 'Asia/Dubai',
    phone: null,
    email: null,
    minOrderCents: 0,
    galleryUrls: [],
    brandId: 'brand-1',
    workingHours: [],
    ...overrides,
  };
}

describe('CatalogService', () => {
  let service: CatalogService;
  let prisma: {
    store: { findMany: jest.Mock; findFirst: jest.Mock };
    stopListEntry: { findMany: jest.Mock };
    category: { findMany: jest.Mock };
    product: { findFirst: jest.Mock };
    order: { groupBy: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      store: { findMany: jest.fn(), findFirst: jest.fn() },
      stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findFirst: jest.fn() },
      // No outstanding work, so the live ETA collapses to the store's base.
      order: { groupBy: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: PrismaService, useValue: prisma },
        // Delivery enabled in tests so `fulfillmentTypes` passes through unchanged.
        { provide: FeatureFlagsService, useValue: { deliveryEnabled: true } },
        // Real service against the mocked client — the ETA arithmetic is
        // part of what these assertions are checking.
        KitchenLoadService,
      ],
    }).compile();

    service = moduleRef.get(CatalogService);
  });

  it('lists stores without lat/lng', async () => {
    prisma.store.findMany.mockResolvedValue([storeFixture()]);
    const result = await service.listStores({});
    expect(result).toHaveLength(1);
    expect(result[0]?.distanceMeters).toBeNull();
  });

  it('computes distance and filters by radius when lat/lng provided', async () => {
    prisma.store.findMany.mockResolvedValue([
      storeFixture({ id: 'near', latitude: 25.078, longitude: 55.141 }),
      storeFixture({ id: 'far', slug: 'far', latitude: 55.75, longitude: 37.61 }),
    ]);
    const result = await service.listStores({ lat: 25.079, lng: 55.14, radius: 5000 });
    expect(result.map((s) => s.id)).toEqual(['near']);
    expect(result[0]?.distanceMeters).toBeGreaterThan(0);
    expect(result[0]?.distanceMeters).toBeLessThan(5000);
  });

  describe('openNow', () => {
    // 07:00–22:00 every day, Dubai time (UTC+4, no DST).
    const dayShift = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      opensAt: 7 * 60,
      closesAt: 22 * 60,
      isClosed: false,
    }));

    afterEach(() => jest.useRealTimers());

    it('is true inside working hours', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-22T08:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }); // 12:00 local
      prisma.store.findMany.mockResolvedValue([storeFixture({ workingHours: dayShift })]);
      const [store] = await service.listStores({});
      expect(store?.openNow).toBe(true);
    });

    it('is false after hours even though the store is switched on', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-22T19:46:00Z'), doNotFake: ['nextTick', 'setImmediate'] }); // 23:46 local
      prisma.store.findMany.mockResolvedValue([storeFixture({ workingHours: dayShift })]);
      const [store] = await service.listStores({});
      expect(store?.status).toBe('OPEN');
      expect(store?.openNow).toBe(false);
    });

    it('is false when an ASAP order would only be ready after closing', async () => {
      // 21:57 local; the 6-minute base ETA lands at 22:03, which order creation refuses.
      jest.useFakeTimers({ now: new Date('2026-09-22T17:57:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
      prisma.store.findMany.mockResolvedValue([storeFixture({ workingHours: dayShift })]);
      const [store] = await service.listStores({});
      expect(store?.openNow).toBe(false);
    });

    it('treats a store with no hours on file as open, like order creation does', async () => {
      prisma.store.findMany.mockResolvedValue([storeFixture({ workingHours: [] })]);
      const [store] = await service.listStores({});
      expect(store?.openNow).toBe(true);
    });

    it('is reported on the store page too', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-22T19:46:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
      prisma.store.findFirst.mockResolvedValue({
        ...storeFixture({ workingHours: dayShift }),
        brand: { id: 'brand-1', slug: 'takeaway', name: 'takeAway', logoUrl: null, themeOverrides: null },
      });
      const store = await service.getStore('store-1');
      expect(store.openNow).toBe(false);
    });
  });

  it('throws 404 when store not found', async () => {
    prisma.store.findFirst.mockResolvedValue(null);
    await expect(service.getStore('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('flags products on stop-list in the menu', async () => {
    prisma.store.findFirst.mockResolvedValue({ id: 'store-1', slug: 'dubai-marina', brandId: 'brand-1' });
    prisma.stopListEntry.findMany.mockResolvedValue([{ productId: 'p-latte' }]);
    prisma.category.findMany.mockResolvedValue([
      {
        id: 'c-coffee',
        slug: 'coffee',
        name: 'Coffee',
        description: null,
        iconUrl: null,
        sortOrder: 0,
        availableFrom: null,
        availableTo: null,
        products: [
          {
            id: 'p-latte',
            categoryId: 'c-coffee',
            slug: 'latte',
            name: 'Latte',
            description: null,
            basePriceCents: 450,
            prepTimeSeconds: 180,
            caffeineLevel: 2,
            calories: 150,
            proteinsGrams: null,
            fatsGrams: null,
            carbsGrams: null,
            allergens: ['milk'],
            dietTags: [],
            imageUrls: [],
            sortOrder: 0,
          },
        ],
      },
    ]);

    const menu = await service.getMenu('dubai-marina');
    expect(menu.categories[0]?.products[0]?.onStopList).toBe(true);
  });

  // A product opened by its own URL carries no store. The cart rejects an
  // item whose brand differs from the store's, so the client has to be able
  // to pick a store that can actually make it.
  it('tells the client which brand a product belongs to', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p-test',
      categoryId: 'c-coffee',
      brandId: 'brand-7',
      slug: 'test',
      name: 'Test',
      description: null,
      basePriceCents: 100,
      prepTimeSeconds: 60,
      caffeineLevel: null,
      calories: null,
      proteinsGrams: null,
      fatsGrams: null,
      carbsGrams: null,
      allergens: [],
      dietTags: [],
      imageUrls: [],
      sortOrder: 0,
      variations: [],
      modifiers: [],
    });

    const product = await service.getProduct('test');

    expect(product.brandId).toBe('brand-7');
  });

  // Two brands can both have a `latte`: the store being browsed decides.
  it("looks a product slug up inside the browsed store's brand", async () => {
    prisma.store.findFirst.mockResolvedValue({ brandId: 'brand-2' });
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.getProduct('latte', 'noname-balka')).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ id: 'noname-balka' }, { slug: 'noname-balka' }] } }),
    );
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ id: 'latte' }, { slug: 'latte' }], brandId: 'brand-2' }),
      }),
    );
  });

  it('refuses a product lookup in a store that does not exist', async () => {
    prisma.store.findFirst.mockResolvedValue(null);

    await expect(service.getProduct('latte', 'nowhere')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });
});
