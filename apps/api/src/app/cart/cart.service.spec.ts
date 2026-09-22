import { Test } from '@nestjs/testing';

import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from './cart.service';

describe('CartService pricing', () => {
  let service: CartService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: {} },
        // These cases only exercise priceItem, which never reaches the
        // kitchen — the provider is here to satisfy the constructor.
        { provide: KitchenLoadService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(CartService);
  });

  it('sums base + selected variations + modifier counts', () => {
    const product = {
      basePriceCents: 450,
      prepTimeSeconds: 180,
      variations: [
        { id: 'v-size-l', type: 'SIZE', priceDeltaCents: 140, prepTimeDeltaSeconds: 30 },
        { id: 'v-size-m', type: 'SIZE', priceDeltaCents: 70, prepTimeDeltaSeconds: 15 },
        { id: 'v-milk-oat', type: 'MILK', priceDeltaCents: 60, prepTimeDeltaSeconds: 0 },
      ],
      modifiers: [
        { id: 'm-shot', priceDeltaCents: 80, prepTimeDeltaSeconds: 20, minCount: 0, maxCount: 3 },
        { id: 'm-syrup', priceDeltaCents: 50, prepTimeDeltaSeconds: 0, minCount: 0, maxCount: 2 },
      ],
    };
    // access private via bracket notation
    const priced = (service as unknown as { priceItem: (...args: unknown[]) => unknown }).priceItem(
      product,
      ['v-size-l', 'v-milk-oat'],
      { 'm-shot': 2, 'm-syrup': 1 },
    ) as { unitPriceCents: number; unitPrepSeconds: number; modifiers: Record<string, number> };

    // base 450 + large 140 + oat 60 + 2 shots (160) + 1 syrup (50) = 860
    expect(priced.unitPriceCents).toBe(860);
    // base 180 + large 30 + 2*20 = 250
    expect(priced.unitPrepSeconds).toBe(250);
    expect(priced.modifiers).toEqual({ 'm-shot': 2, 'm-syrup': 1 });
  });

  it('clamps modifier counts to [minCount, maxCount]', () => {
    const product = {
      basePriceCents: 100,
      prepTimeSeconds: 60,
      variations: [],
      modifiers: [{ id: 'm', priceDeltaCents: 10, prepTimeDeltaSeconds: 0, minCount: 0, maxCount: 2 }],
    };
    const priced = (service as unknown as { priceItem: (...args: unknown[]) => unknown }).priceItem(product, [], {
      m: 5,
    }) as { unitPriceCents: number; modifiers: Record<string, number> };

    expect(priced.modifiers['m']).toBe(2);
    expect(priced.unitPriceCents).toBe(120);
  });

  it('drops unknown variations', () => {
    const product = {
      basePriceCents: 100,
      prepTimeSeconds: 60,
      variations: [{ id: 'real', type: 'SIZE', priceDeltaCents: 50, prepTimeDeltaSeconds: 0 }],
      modifiers: [],
    };
    const priced = (service as unknown as { priceItem: (...args: unknown[]) => unknown }).priceItem(
      product,
      ['ghost', 'real'],
      {},
    ) as { variationIds: string[]; unitPriceCents: number };

    expect(priced.variationIds).toEqual(['real']);
    expect(priced.unitPriceCents).toBe(150);
  });
});

/**
 * The guards in front of `addItem`.
 *
 * A customer reported a 500 from `POST /cart/items` while adding a product
 * whose brand did not own the store the page had picked. The status was a
 * lie — the global exception filter was turning every rejection into a 500
 * — but the rejection itself was real, and these cases pin down what the
 * client is actually told so a wrong store reads as a wrong store.
 */
describe('CartService.addItem guards', () => {
  const product = {
    id: 'p-1',
    brandId: 'brand-a',
    basePriceCents: 500,
    prepTimeSeconds: 60,
    variations: [],
    modifiers: [],
  };

  const build = async (prisma: Record<string, unknown>) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        { provide: KitchenLoadService, useValue: {} },
      ],
    }).compile();
    return moduleRef.get(CartService);
  };

  const add = { storeId: 'store-1', productId: 'p-1', quantity: 1 };

  it('answers 404 when the product is gone', async () => {
    const service = await build({ product: { findUnique: jest.fn().mockResolvedValue(null) } });

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({
      status: 404,
      message: 'Product not found',
    });
  });

  it('answers 404 when the store is gone', async () => {
    const service = await build({
      product: { findUnique: jest.fn().mockResolvedValue(product) },
      store: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({
      status: 404,
      message: 'Store not found',
    });
  });

  it('answers 400, not 500, when the store belongs to another brand', async () => {
    const service = await build({
      product: { findUnique: jest.fn().mockResolvedValue(product) },
      store: { findUnique: jest.fn().mockResolvedValue({ brandId: 'brand-b' }) },
    });

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({
      status: 400,
      message: 'Product does not belong to this store brand',
    });
  });
});
