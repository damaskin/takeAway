import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { CartService } from './cart.service';

describe('CartService pricing', () => {
  let service: CartService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CartService, { provide: PrismaService, useValue: {} }],
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
