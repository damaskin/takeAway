import { Test } from '@nestjs/testing';
import type { CartItem } from '@prisma/client';
import type { ProductOptionGroup } from '@takeaway/shared-types';

import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { StoreAvailabilityService } from '../kitchen/store-availability.service';
import { ProductOptionGroupsService } from '../option-groups/product-option-groups.service';
import { SELLABLE_GROUPS, optionGroupsStub } from '../option-groups/testing/option-groups.stub';
import { PrismaService } from '../prisma/prisma.service';
import { CartChangedException } from './cart-changed.exception';
import { CartService, type StoreProduct } from './cart.service';
import type { AddCartItemDto } from './dto/add-cart-item.dto';

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Every product is sold through its catalog groups; unless a test says
// otherwise it has the stub's: a size M picked by default at no surcharge and
// a free sugar left off (`SELLABLE_GROUPS`) — a variant and an add-on, so
// customers see it.

const SIZE_M = 'stub-size-m';
const SUGAR = 'stub-sugar-yes';
const [SIZE_GROUP] = SELLABLE_GROUPS as [ProductOptionGroup, ProductOptionGroup];

/** A latte at 450, sold in the store the tests order from. */
function latte(overrides: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: 'p-latte',
    brandId: 'brand-a',
    categoryId: 'cat-coffee',
    slug: 'latte',
    name: 'Латте',
    description: null,
    basePriceCents: 450,
    prepTimeSeconds: 180,
    prepParallel: false,
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
    // Sold in the store the tests order from.
    stores: [{ storeId: 'store-1' }],
    category: { visible: true, addOnsOnly: false },
    ...overrides,
  };
}

const openStore = {
  brandId: 'brand-a',
  status: 'OPEN',
  brand: { moderationStatus: 'APPROVED' },
};

/** The availability rules' answer for the store; open for ASAP unless a test says otherwise. */
function availability(patch: { acceptingOrders?: boolean; openNow?: boolean } = {}) {
  return {
    forStore: jest.fn().mockResolvedValue({
      acceptingOrders: true,
      openNow: true,
      asapBlockedReason: null,
      opensAt: null,
      closesAt: null,
      withinHours: true,
      extendedUntil: null,
      currentEtaSeconds: 600,
      brandId: 'brand-a',
      status: 'OPEN',
      ...patch,
    }),
  };
}

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

async function buildService(
  prisma: Record<string, unknown>,
  rules: ReturnType<typeof availability> = availability(),
  groups: Record<string, ProductOptionGroup[]> = {},
): Promise<CartService> {
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
      { provide: StoreAvailabilityService, useValue: rules },
      { provide: ProductOptionGroupsService, useValue: optionGroupsStub(groups) },
    ],
  }).compile();
  return moduleRef.get(CartService);
}

/**
 * What a line has to be before it goes into a cart: the product on the menu
 * of this store, with a variant and an add-on, and the same drink twice on
 * one line. The catalog rules themselves are in `cart.option-groups.spec.ts`.
 */
describe('CartService add-to-cart', () => {
  let prisma: {
    product: { findUnique: jest.Mock };
    store: { findUnique: jest.Mock };
    stopListEntry: { findMany: jest.Mock };
    cart: { upsert: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    cartItem: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
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
      cartItem: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = await buildService(prisma);
  });

  const created = () => prisma.cartItem.create.mock.calls[0]?.[0]?.data;

  /** A line already in the cart: the default latte (size M, no sugar). */
  const line = (patch: Record<string, unknown> = {}) => ({
    id: 'ci-1',
    productId: 'p-latte',
    quantity: 1,
    optionsJson: [{ optionId: SIZE_M, qty: 1 }],
    notes: null,
    ...patch,
  });

  it('adds the same drink again to its existing line instead of starting a second one', async () => {
    prisma.cartItem.findMany.mockResolvedValue([line()]);

    await add({ quantity: 2, options: [{ optionId: SIZE_M, qty: 1 }] });

    expect(prisma.cartItem.create).not.toHaveBeenCalled();
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: expect.objectContaining({ quantity: 3 }),
    });
  });

  it('keeps a differently made drink on a line of its own', async () => {
    prisma.cartItem.findMany.mockResolvedValue([line(), line({ id: 'ci-2', notes: 'extra hot' })]);

    await add({
      options: [
        { optionId: SIZE_M, qty: 1 },
        { optionId: SUGAR, qty: 1 },
      ],
    });
    await add({ notes: 'с собой' });

    expect(prisma.cartItem.update).not.toHaveBeenCalled();
    expect(prisma.cartItem.create).toHaveBeenCalledTimes(2);
  });

  it('never merges a line past the 99 a single line may hold', async () => {
    prisma.cartItem.findMany.mockResolvedValue([line({ quantity: 98 })]);

    await add({ quantity: 5 });

    expect(prisma.cartItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 99 }) }),
    );
  });

  it('ignores the older variations and extras an app build from before still sends', async () => {
    await add({ variationIds: ['v-l'], modifiers: { 'm-vanilla': 1 } });

    expect(created()).toEqual(
      expect.objectContaining({ optionsJson: [{ optionId: SIZE_M, qty: 1 }], unitPriceCents: 450 }),
    );
    expect(created()).not.toHaveProperty('variationIds');
    expect(created()).not.toHaveProperty('modifiersJson');
  });

  // Owner, 2026-11-18: a product customers do not see is not sold either.
  it('answers 404 for a product without a variant and an add-on, as the catalog does', async () => {
    service = await buildService(prisma, availability(), { 'p-latte': [SIZE_GROUP] });

    await expect(add({})).rejects.toMatchObject({ status: 404, message: 'Product not found' });

    service = await buildService(prisma, availability(), { 'p-latte': [] });
    await expect(add({})).rejects.toMatchObject({ status: 404, message: 'Product not found' });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a hidden product, as the catalog does', async () => {
    prisma.product.findUnique.mockResolvedValue(latte({ visible: false }));

    await expect(add({})).rejects.toMatchObject({ status: 404, message: 'Product not found' });
  });

  // NoName's «Дополнительные ингредиенты» came in from Poster as products:
  // a shot of syrup is added to a drink, never bought on its own.
  it('answers 404 for a product of an add-ons-only category, as the catalog does', async () => {
    prisma.product.findUnique.mockResolvedValue(latte({ category: { visible: true, addOnsOnly: true } }));

    await expect(add({})).rejects.toMatchObject({ status: 404, message: 'Product not found' });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a product whose category is hidden from the menu', async () => {
    prisma.product.findUnique.mockResolvedValue(latte({ category: { visible: false, addOnsOnly: false } }));

    await expect(add({})).rejects.toMatchObject({ status: 404, message: 'Product not found' });
  });

  it('loads the product as this store sells it: its listing there and its category, nothing else', async () => {
    await add({});

    const include = prisma.product.findUnique.mock.calls[0]?.[0]?.include;
    expect(include).toEqual({
      stores: { where: { storeId: 'store-1' }, select: { storeId: true } },
      category: { select: { visible: true, addOnsOnly: true } },
    });
  });

  // The brand's burger is not sold in its pizzeria: the menu there never
  // shows it, and a shared link or a direct call must not order it either.
  it('refuses a product the store does not sell, with the coded "unavailable" error', async () => {
    prisma.product.findUnique.mockResolvedValue(latte({ stores: [] }));

    await expect(add({})).rejects.toMatchObject({
      status: 400,
      response: { code: 'ITEMS_UNAVAILABLE', items: ['Латте'] },
    });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
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

  /** A cart row for two lattes, size M with sugar, priced as when it went in. */
  function row(overrides: Partial<CartItem & { product: StoreProduct }> = {}): CartItem & { product: StoreProduct } {
    return {
      id: 'ci-1',
      cartId: 'cart-1',
      productId: 'p-latte',
      quantity: 2,
      optionsJson: [
        { optionId: SIZE_M, qty: 1 },
        { optionId: SUGAR, qty: 1 },
      ],
      unitPriceCents: 450,
      unitPrepSeconds: 180,
      notes: 'поменьше пены',
      createdAt: new Date('2026-09-23T08:00:00Z'),
      updatedAt: new Date('2026-09-23T08:00:00Z'),
      product: latte(),
      ...overrides,
    };
  }

  const reprice = (...items: Array<CartItem & { product: StoreProduct }>) =>
    service.repriceForCheckout({ id: 'cart-1', storeId: 'store-1', items });

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
      unitPriceCents: 450,
      notes: 'поменьше пены',
      options: [
        { optionId: SIZE_M, qty: 1 },
        { optionId: SUGAR, qty: 1 },
      ],
    });
    expect(line?.optionLines.map((o) => o.name)).toEqual(['M', 'Сахар']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a line whose price changed, and leaves the new price in the cart', async () => {
    const err = await conflictOf(reprice(row({ product: latte({ basePriceCents: 500 }) })));

    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({
      code: 'CART_CHANGED',
      items: [{ cartItemId: 'ci-1', reason: 'PRICE_CHANGED', previousUnitPriceCents: 450, unitPriceCents: 500 }],
    });
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: expect.objectContaining({ unitPriceCents: 500 }),
    });
    // Subtotal and ETA are recomputed, so the next GET /cart shows the truth.
    expect(prisma.cart.update).toHaveBeenCalled();
  });

  it('takes out a line whose option is gone rather than making it without', async () => {
    const err = await conflictOf(reprice(row({ optionsJson: [{ optionId: 'oi-gone', qty: 1 }] })));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'OPTION_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
    expect(prisma.cartItem.update).not.toHaveBeenCalled();
  });

  // Owner, 2026-11-18: the add-on group was detached — customers no longer see the latte.
  it('takes out a line whose product lost its variant or add-on, as a product no longer sold', async () => {
    service = await buildService(prisma, availability(), { 'p-latte': [SIZE_GROUP] });

    const err = await conflictOf(reprice(row()));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'PRODUCT_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
  });

  it('takes out a line whose product was hidden', async () => {
    const err = await conflictOf(reprice(row({ product: latte({ visible: false }) })));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'PRODUCT_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
  });

  it('takes out a line whose category became add-ons only after it went in', async () => {
    const err = await conflictOf(reprice(row({ product: latte({ category: { visible: true, addOnsOnly: true } }) })));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'PRODUCT_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
  });

  it('takes out a line whose product the store stopped selling', async () => {
    const err = await conflictOf(reprice(row({ product: latte({ stores: [] }) })));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'PRODUCT_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
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
    stores: [{ storeId: 'store-1' }],
    category: { visible: true, addOnsOnly: false },
  };

  const build = async (prisma: Record<string, unknown>, rules = availability()) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        { provide: KitchenLoadService, useValue: {} },
        { provide: StoreAvailabilityService, useValue: rules },
        { provide: ProductOptionGroupsService, useValue: optionGroupsStub() },
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
        findUnique: jest.fn().mockResolvedValue({ ...openStore, brandId: 'brand-b' }),
      },
    });

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({
      status: 400,
      message: 'Product does not belong to this store brand',
    });
  });

  it('refuses a store that takes no order at all — switched off, or no hours within a day — even from a direct link', async () => {
    const upsert = jest.fn();
    const service = await build(
      {
        product: { findUnique: jest.fn().mockResolvedValue(product) },
        store: { findUnique: jest.fn().mockResolvedValue(openStore) },
        cart: { upsert },
      },
      availability({ acceptingOrders: false, openNow: false }),
    );

    await expect(service.addItem('user-1', add)).rejects.toMatchObject({
      status: 400,
      message: 'This store is not taking orders right now',
      response: { code: 'STORE_NOT_TAKING_ORDERS' },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fills a basket while the shift is closed — the store still takes pre-orders', async () => {
    const service = await buildService(
      {
        product: { findUnique: jest.fn().mockResolvedValue({ ...product, slug: 'p-1', name: 'Latte', sortOrder: 0 }) },
        store: { findUnique: jest.fn().mockResolvedValue(openStore) },
        stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
        cart: {
          upsert: jest.fn().mockResolvedValue({ id: 'cart-1' }),
          findUnique: jest.fn().mockResolvedValue(emptyCart()),
          update: jest.fn().mockResolvedValue({}),
        },
        cartItem: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      },
      availability({ acceptingOrders: true, openNow: false }),
    );

    await expect(service.addItem('user-1', add)).resolves.toMatchObject({ id: 'cart-1' });
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
