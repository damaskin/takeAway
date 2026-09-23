import { Test } from '@nestjs/testing';
import type { CartItem, Modifier, Variation } from '@prisma/client';

import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { PrismaService } from '../prisma/prisma.service';
import { CartChangedException } from './cart-changed.exception';
import { CartService, type PricedProduct } from './cart.service';
import type { AddCartItemDto } from './dto/add-cart-item.dto';

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

  type Priced = {
    line: {
      unitPriceCents: number;
      unitPrepSeconds: number;
      variationIds: string[];
      modifiers: Record<string, number>;
    };
    problems: string[];
  };
  // access private via bracket notation
  const priceItem = (...args: unknown[]): Priced =>
    (service as unknown as { priceItem: (...a: unknown[]) => Priced }).priceItem(...args);

  it('sums base + selected variations + modifier counts', () => {
    const product = {
      name: 'Latte',
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
    const { line, problems } = priceItem(product, ['v-size-l', 'v-milk-oat'], { 'm-shot': 2, 'm-syrup': 1 });

    expect(problems).toEqual([]);
    // base 450 + large 140 + oat 60 + 2 shots (160) + 1 syrup (50) = 860
    expect(line.unitPriceCents).toBe(860);
    // base 180 + large 30 + 2*20 = 250
    expect(line.unitPrepSeconds).toBe(250);
    expect(line.modifiers).toEqual({ 'm-shot': 2, 'm-syrup': 1 });
  });

  it('clamps modifier counts to [minCount, maxCount]', () => {
    const product = {
      name: 'Latte',
      basePriceCents: 100,
      prepTimeSeconds: 60,
      variations: [],
      modifiers: [{ id: 'm', priceDeltaCents: 10, prepTimeDeltaSeconds: 0, minCount: 0, maxCount: 2 }],
    };
    const { line } = priceItem(product, [], { m: 5 });

    expect(line.modifiers['m']).toBe(2);
    expect(line.unitPriceCents).toBe(120);
  });

  it('reports an unknown variation instead of silently dropping it', () => {
    const product = {
      name: 'Latte',
      basePriceCents: 100,
      prepTimeSeconds: 60,
      variations: [{ id: 'real', type: 'SIZE', priceDeltaCents: 50, prepTimeDeltaSeconds: 0 }],
      modifiers: [],
    };
    const { line, problems } = priceItem(product, ['ghost', 'real'], {});

    expect(problems).toEqual(['Option not available for Latte: ghost']);
    expect(line.variationIds).toEqual(['real']);
    expect(line.unitPriceCents).toBe(150);
  });
});

// ── Fixtures for the option-rule and checkout suites ────────────────────────

function variation(v: Partial<Variation> & Pick<Variation, 'id' | 'type' | 'name'>): Variation {
  return { productId: 'p-latte', priceDeltaCents: 0, prepTimeDeltaSeconds: 0, sortOrder: 0, isDefault: false, ...v };
}

function modifier(m: Partial<Modifier> & Pick<Modifier, 'id' | 'name'>): Modifier {
  return {
    productId: 'p-latte',
    slug: m.id,
    priceDeltaCents: 0,
    prepTimeDeltaSeconds: 0,
    minCount: 0,
    maxCount: 3,
    sortOrder: 0,
    externalProvider: null,
    externalId: null,
    ...m,
  };
}

/** A latte with a default size (M), an undefaulted milk, and two extras. */
function latte(overrides: Partial<PricedProduct> = {}): PricedProduct {
  return {
    id: 'p-latte',
    brandId: 'brand-a',
    categoryId: 'cat-coffee',
    slug: 'latte',
    name: 'Латте',
    description: null,
    basePriceCents: 450,
    prepTimeSeconds: 180,
    caffeineLevel: null,
    calories: null,
    proteinsGrams: null,
    fatsGrams: null,
    carbsGrams: null,
    allergens: [],
    dietTags: [],
    imageUrls: [],
    visible: true,
    sortOrder: 0,
    availableFrom: null,
    availableTo: null,
    externalProvider: null,
    externalId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    variations: [
      variation({ id: 'v-s', type: 'SIZE', name: 'S', sortOrder: 1 }),
      variation({ id: 'v-m', type: 'SIZE', name: 'M', priceDeltaCents: 70, sortOrder: 2, isDefault: true }),
      variation({ id: 'v-l', type: 'SIZE', name: 'L', priceDeltaCents: 140, sortOrder: 3 }),
      variation({ id: 'v-cow', type: 'MILK', name: 'Коровье', sortOrder: 1 }),
      variation({ id: 'v-oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 60, sortOrder: 2 }),
    ],
    modifiers: [
      modifier({ id: 'm-vanilla', name: 'Ваниль', priceDeltaCents: 50, sortOrder: 2 }),
      modifier({ id: 'm-shot', name: 'Эспрессо', priceDeltaCents: 80, prepTimeDeltaSeconds: 20, sortOrder: 1 }),
    ],
    ...overrides,
  };
}

const openStore = { brandId: 'brand-a', status: 'OPEN', brand: { moderationStatus: 'APPROVED' } };

function emptyCart() {
  return {
    id: 'cart-1',
    userId: 'user-1',
    storeId: 'store-1',
    subtotalCents: 0,
    etaSeconds: 0,
    updatedAt: new Date('2026-09-23T08:00:00Z'),
    items: [],
  };
}

async function buildService(prisma: Record<string, unknown>): Promise<CartService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      CartService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: KitchenLoadService,
        useValue: {
          timings: jest.fn().mockReturnValue({ prepSeconds: 0, workSeconds: 0 }),
          quote: jest.fn().mockResolvedValue({ etaSeconds: 0 }),
        },
      },
    ],
  }).compile();
  return moduleRef.get(CartService);
}

/**
 * The rules a selection has to follow before it goes into a cart. Each of
 * these used to be silently "fixed", or not checked at all, so the price and
 * the kitchen ticket could disagree with what the customer saw.
 */
describe('CartService option rules on add-to-cart', () => {
  let prisma: {
    product: { findUnique: jest.Mock };
    store: { findUnique: jest.Mock };
    stopListEntry: { findMany: jest.Mock };
    cart: { upsert: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    cartItem: { create: jest.Mock };
  };
  let service: CartService;

  const add = (selection: Partial<AddCartItemDto>) =>
    service.addItem('user-1', { storeId: 'store-1', productId: 'p-latte', quantity: 1, ...selection });

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(latte()) },
      store: { findUnique: jest.fn().mockResolvedValue(openStore) },
      stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'cart-1' }),
        findUnique: jest.fn().mockResolvedValue(emptyCart()),
        update: jest.fn().mockResolvedValue({}),
      },
      cartItem: { create: jest.fn().mockResolvedValue({}) },
    };
    service = await buildService(prisma);
  });

  const created = () => prisma.cartItem.create.mock.calls[0]?.[0]?.data;

  it('refuses two sizes for one drink', async () => {
    await expect(add({ variationIds: ['v-s', 'v-l'] })).rejects.toMatchObject({
      status: 400,
      message: 'Choose one size for Латте',
    });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('refuses a variation the product does not have', async () => {
    await expect(add({ variationIds: ['v-l', 'v-ghost'] })).rejects.toMatchObject({
      status: 400,
      message: 'Option not available for Латте: v-ghost',
    });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('refuses an extra the product does not have, but not one asked for zero times', async () => {
    await expect(add({ modifiers: { 'm-ghost': 1 } })).rejects.toMatchObject({ status: 400 });

    await add({ modifiers: { 'm-ghost': 0, 'm-vanilla': 1 } });
    expect(created()).toMatchObject({ modifiersJson: { 'm-vanilla': 1 } });
  });

  it('fills a size left open with the default one, and charges for it', async () => {
    await add({ variationIds: ['v-oat'] });

    // base 450 + default M 70 + oat 60
    expect(created()).toMatchObject({ variationIds: ['v-m', 'v-oat'], unitPriceCents: 580 });
  });

  it('falls back to the first on the menu when no variation of a type is marked default', async () => {
    await add({ variationIds: ['v-l'] });

    // No milk is marked default, so the first by sort order goes in.
    expect(created()).toMatchObject({ variationIds: ['v-l', 'v-cow'], unitPriceCents: 590 });
  });

  it('never prices a line below zero', async () => {
    prisma.product.findUnique.mockResolvedValue(
      latte({
        basePriceCents: 100,
        variations: [variation({ id: 'v-kids', type: 'SIZE', name: 'Kids', priceDeltaCents: -150 })],
        modifiers: [],
      }),
    );

    await add({ variationIds: ['v-kids'] });
    expect(created()).toMatchObject({ unitPriceCents: 0 });
  });

  it('answers 404 for a hidden product, as the catalog does', async () => {
    prisma.product.findUnique.mockResolvedValue(latte({ visible: false }));

    await expect(add({})).rejects.toMatchObject({ status: 404, message: 'Product not found' });
  });
});

/**
 * Checkout prices the cart again against the menu as it is now. A line the
 * menu no longer supports must not be charged or reach the kitchen as it was
 * stored; the customer gets a 409 and a cart that shows the truth.
 */
describe('CartService.repriceForCheckout', () => {
  let prisma: {
    $transaction: jest.Mock;
    cartItem: { deleteMany: jest.Mock; update: jest.Mock };
    cart: { findUnique: jest.Mock; update: jest.Mock };
  };
  let service: CartService;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      cartItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      cart: {
        findUnique: jest.fn().mockResolvedValue(emptyCart()),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = await buildService(prisma);
  });

  /** A cart row for two L oat lattes with two vanillas each, priced as when it went in. */
  function row(overrides: Partial<CartItem & { product: PricedProduct }> = {}): CartItem & { product: PricedProduct } {
    return {
      id: 'ci-1',
      cartId: 'cart-1',
      productId: 'p-latte',
      quantity: 2,
      variationIds: ['v-l', 'v-oat'],
      modifiersJson: { 'm-vanilla': 2 },
      // 450 + 140 + 60 + 2 × 50
      unitPriceCents: 750,
      unitPrepSeconds: 180,
      notes: 'поменьше пены',
      createdAt: new Date('2026-09-23T08:00:00Z'),
      updatedAt: new Date('2026-09-23T08:00:00Z'),
      product: latte(),
      ...overrides,
    };
  }

  const reprice = (...items: Array<CartItem & { product: PricedProduct }>) =>
    service.repriceForCheckout({ id: 'cart-1', items });

  async function conflictOf(pending: Promise<unknown>): Promise<CartChangedException> {
    const err = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    if (!(err instanceof CartChangedException)) throw new Error(`expected a CartChangedException, got ${err}`);
    return err;
  }

  it('hands back lines named and priced for the order when nothing changed', async () => {
    const [line] = await reprice(row());

    expect(line).toMatchObject({
      productName: 'Латте',
      quantity: 2,
      unitPriceCents: 750,
      notes: 'поменьше пены',
      variations: [
        { id: 'v-l', type: 'SIZE', name: 'L', priceDeltaCents: 140 },
        { id: 'v-oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 60 },
      ],
      modifierLines: [{ id: 'm-vanilla', name: 'Ваниль', count: 2, priceCents: 50 }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a line whose price changed, and leaves the new price in the cart', async () => {
    const err = await conflictOf(reprice(row({ product: latte({ basePriceCents: 500 }) })));

    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({
      code: 'CART_CHANGED',
      items: [{ cartItemId: 'ci-1', reason: 'PRICE_CHANGED', previousUnitPriceCents: 750, unitPriceCents: 800 }],
    });
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: expect.objectContaining({ unitPriceCents: 800 }),
    });
    // Subtotal and ETA are recomputed, so the next GET /cart shows the truth.
    expect(prisma.cart.update).toHaveBeenCalled();
  });

  it('takes out a line whose milk was deleted rather than making it with another', async () => {
    const withoutOat = latte();
    withoutOat.variations = withoutOat.variations.filter((v) => v.id !== 'v-oat');

    const err = await conflictOf(reprice(row({ product: withoutOat })));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'OPTION_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  it('takes out a line whose product was hidden', async () => {
    const err = await conflictOf(reprice(row({ product: latte({ visible: false }) })));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'PRODUCT_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
  });

  it('reports an extra cut down to the menu limit even when the price stays the same', async () => {
    const freeVanilla = latte();
    freeVanilla.modifiers = [modifier({ id: 'm-vanilla', name: 'Ваниль', maxCount: 1 })];

    // 450 + 140 + 60 + 2 × 0
    const err = await conflictOf(reprice(row({ product: freeVanilla, unitPriceCents: 650 })));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'OPTIONS_CHANGED', unitPriceCents: 650 })]);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: expect.objectContaining({ modifiersJson: { 'm-vanilla': 1 } }),
    });
  });

  it('fills an option left open with its default without calling it a change', async () => {
    // Stored before defaults were applied: no milk. Cow's milk is the free
    // default, so the price stands and only the ticket gains a line.
    const [line] = await reprice(row({ variationIds: ['v-l'], unitPriceCents: 690 }));

    expect(line?.variations.map((v) => v.name)).toEqual(['L', 'Коровье']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
    visible: true,
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
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ brandId: 'brand-b', status: 'OPEN', brand: { moderationStatus: 'APPROVED' } }),
      },
    });

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({
      status: 400,
      message: 'Product does not belong to this store brand',
    });
  });

  it('refuses a store that has been switched off, even from a direct link', async () => {
    const service = await build({
      product: { findUnique: jest.fn().mockResolvedValue(product) },
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ brandId: 'brand-a', status: 'CLOSED', brand: { moderationStatus: 'APPROVED' } }),
      },
    });

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({
      status: 400,
      message: 'This store is not taking orders right now',
    });
  });

  it('treats a store of a brand still in moderation as not there', async () => {
    const service = await build({
      product: { findUnique: jest.fn().mockResolvedValue(product) },
      store: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ brandId: 'brand-a', status: 'OPEN', brand: { moderationStatus: 'PENDING' } }),
      },
    });

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({ status: 404, message: 'Store not found' });
  });
});
