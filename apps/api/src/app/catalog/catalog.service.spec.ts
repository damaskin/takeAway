import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

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
    currentEtaSeconds: 360,
    currency: 'AED',
    heroImageUrl: null,
    timezone: 'Asia/Dubai',
    phone: null,
    email: null,
    minOrderCents: 0,
    galleryUrls: [],
    brandId: 'brand-1',
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
  };

  beforeEach(async () => {
    prisma = {
      store: { findMany: jest.fn(), findFirst: jest.fn() },
      stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findFirst: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [CatalogService, { provide: PrismaService, useValue: prisma }],
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
});
