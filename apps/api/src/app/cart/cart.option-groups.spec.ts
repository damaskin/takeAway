import type { CartItem } from '@prisma/client';
import type { OptionSelection, ProductOptionGroup, ProductOptionItem } from '@takeaway/shared-types';

import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import { optionGroupsStub } from '../option-groups/testing/option-groups.stub';
import type { PrismaService } from '../prisma/prisma.service';
import { CartChangedException } from './cart-changed.exception';
import { CartService, type StoreProduct } from './cart.service';

// ── The spec's example (§6): a cappuccino M, hot, oat, vanilla + salted caramel, sugar ×2 = 71.00 ────

function item(id: string, name: string, patch: Partial<ProductOptionItem> = {}): ProductOptionItem {
  return {
    id,
    name,
    note: null,
    isDefault: false,
    minQty: null,
    maxQty: null,
    defaultQty: null,
    priceCents: 0,
    available: true,
    sortOrder: 0,
    ...patch,
  };
}

function group(
  g: Pick<ProductOptionGroup, 'id' | 'kind' | 'type' | 'name' | 'options'> & Partial<ProductOptionGroup>,
): ProductOptionGroup {
  return { minSelect: null, maxSelect: null, showIfOptionId: null, ...g };
}

/** Sizes are priced per product; the base price is M's. */
const size = group({
  id: 'og_coffee_size',
  kind: 'VARIANT',
  type: 'A',
  name: 'Размер (кофе)',
  minSelect: 1,
  maxSelect: 1,
  options: [item('oi_s', 'S', { priceCents: -500 }), item('oi_m', 'M'), item('oi_l', 'L', { priceCents: 1000 })],
});
const serving = group({
  id: 'og_serving',
  kind: 'VARIANT',
  type: 'A',
  name: 'Подача',
  minSelect: 1,
  maxSelect: 1,
  options: [item('oi_hot', 'Горячий', { isDefault: true }), item('oi_cold', 'Холодный')],
});
const milk = (oatCents = 1000, oat: Partial<ProductOptionItem> = {}) =>
  group({
    id: 'og_milk',
    kind: 'ADDON',
    type: 'A',
    name: 'Молоко',
    minSelect: 1,
    maxSelect: 1,
    options: [
      item('oi_cow', 'Коровье', { isDefault: true }),
      item('oi_oat', 'Овсяное', { priceCents: oatCents, ...oat }),
    ],
  });
const syrups = group({
  id: 'og_syrups',
  kind: 'ADDON',
  type: 'A',
  name: 'Сиропы',
  minSelect: 0,
  maxSelect: 2,
  options: [
    item('oi_vanilla', 'Ваниль', { priceCents: 800 }),
    item('oi_caramel', 'Карамель', { priceCents: 800 }),
    item('oi_salted', 'Солёная карамель', { priceCents: 800 }),
  ],
});
const sugar = group({
  id: 'og_sugar',
  kind: 'ADDON',
  type: 'C',
  name: 'Сахар',
  options: [item('oi_sugar', 'Сахар', { minQty: 0, maxQty: 3, defaultQty: 0 })],
});
const ice = group({
  id: 'og_ice',
  kind: 'ADDON',
  type: 'C',
  name: 'Лёд',
  showIfOptionId: 'oi_cold',
  options: [item('oi_ice', 'Лёд', { minQty: 0, maxQty: 3, defaultQty: 0, priceCents: 100 })],
});
const cappuccinoGroups = (milkGroup = milk()) => [size, serving, milkGroup, syrups, sugar, ice];

/** «Мясо (порции)»: one portion is in the price, the second costs 20.00. */
const shawarmaGroups = [
  group({
    id: 'og_meat_portions',
    kind: 'ADDON',
    type: 'C',
    name: 'Мясо (порции)',
    options: [item('oi_meat', 'Мясо / котлета', { minQty: 1, maxQty: 2, defaultQty: 1, priceCents: 2000 })],
  }),
];

const PICKS: OptionSelection[] = [
  { optionId: 'oi_m', qty: 1 },
  { optionId: 'oi_hot', qty: 1 },
  { optionId: 'oi_oat', qty: 1 },
  { optionId: 'oi_vanilla', qty: 1 },
  { optionId: 'oi_salted', qty: 1 },
  { optionId: 'oi_sugar', qty: 2 },
];
/** The same picks as a cart row keeps them: sorted by option id. */
const STORED = [...PICKS]
  .sort((a, b) => a.optionId.localeCompare(b.optionId))
  .map(({ optionId, qty }) => ({ optionId, qty }));

function product(id: string, name: string, basePriceCents: number, patch: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id,
    brandId: 'brand-a',
    categoryId: 'cat',
    slug: id,
    name,
    description: null,
    basePriceCents,
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
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    stores: [{ storeId: 'store-1' }],
    category: { visible: true, addOnsOnly: false },
    variations: [],
    modifiers: [],
    ...patch,
  };
}

const cappuccino = product('p-cappuccino', 'Капучино', 4500);
const shawarma = product('p-shawarma', 'Шаурма', 6000);

function harness(groups: Record<string, ProductOptionGroup[]> = { 'p-cappuccino': cappuccinoGroups() }) {
  const cartRow = { id: 'cart-1', userId: 'user-1', storeId: 'store-1', subtotalCents: 0, etaSeconds: 0 };
  const prisma = {
    product: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p-shawarma' ? shawarma : cappuccino),
      ),
    },
    store: { findUnique: jest.fn().mockResolvedValue({ brandId: 'brand-a', brand: { moderationStatus: 'APPROVED' } }) },
    stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    modifier: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    cart: {
      upsert: jest.fn().mockResolvedValue({ id: 'cart-1' }),
      findUnique: jest.fn().mockResolvedValue({ ...cartRow, updatedAt: new Date(), items: [] }),
      update: jest.fn().mockResolvedValue({}),
    },
    cartItem: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const kitchen = {
    timings: jest.fn().mockReturnValue({ prepSeconds: 0, workSeconds: 0 }),
    quote: jest.fn().mockResolvedValue({ etaSeconds: 0 }),
  };
  const availability = { forStore: jest.fn().mockResolvedValue({ acceptingOrders: true }) };
  const stub = optionGroupsStub(groups);
  const service = new CartService(
    prisma as unknown as PrismaService,
    kitchen as unknown as KitchenLoadService,
    availability as unknown as StoreAvailabilityService,
    stub,
  );
  return { prisma, service, cartRow };
}

async function rejectionOf(pending: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const err = (await pending.then(
    () => null,
    (e: unknown) => e,
  )) as { getStatus?: () => number; getResponse?: () => unknown } | null;
  if (!err?.getStatus || !err.getResponse) throw new Error(`expected an HTTP error, got ${String(err)}`);
  return { status: err.getStatus(), body: err.getResponse() as Record<string, unknown> };
}

describe('CartService with the options catalog — add', () => {
  const add = (service: CartService, patch: Record<string, unknown> = {}) =>
    service.addItem('user-1', { storeId: 'store-1', productId: 'p-cappuccino', quantity: 1, ...patch });

  it("prices the spec's cappuccino at 71.00 and keeps the picks sorted, without the older options", async () => {
    const { prisma, service } = harness();
    // An older client's size and extras are ignored on a catalog product, not refused.
    await add(service, { options: PICKS, variationIds: ['v-l'], modifiers: { 'm-shot': 1 } });

    expect(prisma.cartItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'p-cappuccino',
        unitPriceCents: 7100,
        unitPrepSeconds: 180,
        variationIds: [],
        modifiersJson: {},
        optionsJson: STORED,
      }),
    });
    expect(prisma.variation.findMany).not.toHaveBeenCalled();
  });

  it('charges a counter only above what the dish includes (meat 1 free, 2 = one portion more)', async () => {
    const { prisma, service } = harness({ 'p-shawarma': shawarmaGroups });
    await service.addItem('user-1', {
      storeId: 'store-1',
      productId: 'p-shawarma',
      quantity: 1,
      options: [{ optionId: 'oi_meat', qty: 2 }],
    });
    expect(prisma.cartItem.create.mock.calls[0][0].data.unitPriceCents).toBe(8000);

    const err = await rejectionOf(
      service.addItem('user-1', {
        storeId: 'store-1',
        productId: 'p-shawarma',
        quantity: 1,
        options: [{ optionId: 'oi_meat', qty: 0 }],
      }),
    );
    expect(err.body).toMatchObject({ code: 'OPTIONS_INVALID', errors: [{ code: 'TOO_FEW', optionId: 'oi_meat' }] });
  });

  it('takes the defaults when an older client sends no options and they make a valid choice', async () => {
    const { prisma, service } = harness({ 'p-shawarma': shawarmaGroups });
    await service.addItem('user-1', { storeId: 'store-1', productId: 'p-shawarma', quantity: 1 });

    expect(prisma.cartItem.create.mock.calls[0][0].data).toMatchObject({
      unitPriceCents: 6000,
      optionsJson: [{ optionId: 'oi_meat', qty: 1 }],
    });
  });

  it('answers OPTIONS_REQUIRED when an older client sends no options and a size has to be picked', async () => {
    const { prisma, service } = harness();
    const err = await rejectionOf(add(service));

    expect(err.status).toBe(400);
    expect(err.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      code: 'OPTIONS_REQUIRED',
      message: 'Обновите приложение, чтобы выбрать вариант',
      errors: [{ code: 'TOO_FEW', groupId: 'og_coffee_size', optionId: null }],
    });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a third syrup',
      [...PICKS, { optionId: 'oi_caramel', qty: 1 }],
      { code: 'TOO_MANY', groupId: 'og_syrups', optionId: null },
    ],
    [
      'ice on a hot drink',
      [...PICKS, { optionId: 'oi_ice', qty: 1 }],
      { code: 'HIDDEN_GROUP', groupId: 'og_ice', optionId: 'oi_ice' },
    ],
    [
      'an option of another product',
      [...PICKS, { optionId: 'oi_meat', qty: 1 }],
      { code: 'UNKNOWN_OPTION', groupId: null, optionId: 'oi_meat' },
    ],
    ['no size', PICKS.filter((p) => p.optionId !== 'oi_m'), { code: 'TOO_FEW', groupId: 'og_coffee_size' }],
    ['a fraction', [...PICKS, { optionId: 'oi_l', qty: 0.5 }], { code: 'BAD_QTY', optionId: 'oi_l' }],
  ])('refuses %s with OPTIONS_INVALID', async (_what, options, error) => {
    const { prisma, service } = harness();
    const err = await rejectionOf(add(service, { options }));

    expect(err.status).toBe(400);
    expect(err.body).toMatchObject({
      code: 'OPTIONS_INVALID',
      errors: expect.arrayContaining([expect.objectContaining(error)]),
    });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('refuses an option the store has run out of', async () => {
    const { service } = harness({ 'p-cappuccino': cappuccinoGroups(milk(1000, { available: false })) });
    const err = await rejectionOf(add(service, { options: PICKS }));

    expect(err.body).toMatchObject({
      code: 'OPTIONS_INVALID',
      message: 'Части выбранного сейчас нет в наличии',
      errors: [{ code: 'OPTION_UNAVAILABLE', groupId: 'og_milk', optionId: 'oi_oat' }],
    });
  });

  it('adds iced with ice: a hidden group opens with its condition', async () => {
    const { prisma, service } = harness();
    const iced = PICKS.map((p) => (p.optionId === 'oi_hot' ? { optionId: 'oi_cold', qty: 1 } : p));
    await add(service, { options: [...iced, { optionId: 'oi_ice', qty: 2 }] });

    expect(prisma.cartItem.create.mock.calls[0][0].data.unitPriceCents).toBe(7100 + 2 * 100);
  });

  it('merges the same picks and note into one line, and keeps a different choice apart', async () => {
    const { prisma, service } = harness();
    prisma.cartItem.findMany.mockResolvedValue([
      { id: 'ci-same', quantity: 1, variationIds: [], modifiersJson: {}, optionsJson: STORED, notes: null },
      { id: 'ci-note', quantity: 1, variationIds: [], modifiersJson: {}, optionsJson: STORED, notes: 'горячее' },
    ]);

    // Same choice in another order, a repeated pick adding up: still the same line.
    const reordered = [
      ...PICKS.filter((p) => p.optionId !== 'oi_sugar').reverse(),
      ...[1, 1].map((qty) => ({ optionId: 'oi_sugar', qty })),
    ];
    await add(service, { options: reordered, quantity: 2 });
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-same' },
      data: expect.objectContaining({ quantity: 3, unitPriceCents: 7100 }),
    });
    expect(prisma.cartItem.create).not.toHaveBeenCalled();

    // One sugar less is another drink.
    await add(service, { options: PICKS.map((p) => (p.optionId === 'oi_sugar' ? { ...p, qty: 1 } : p)) });
    expect(prisma.cartItem.create).toHaveBeenCalledTimes(1);
  });

  it('shows the picks with names and prices on the cart line', async () => {
    const { prisma, service, cartRow } = harness();
    prisma.cart.findUnique.mockResolvedValue({
      ...cartRow,
      updatedAt: new Date(),
      items: [
        {
          id: 'ci-1',
          productId: 'p-cappuccino',
          product: { name: 'Капучино', brandId: 'brand-a' },
          quantity: 1,
          variationIds: [],
          modifiersJson: {},
          optionsJson: STORED,
          unitPriceCents: 7100,
          unitPrepSeconds: 180,
          notes: null,
        },
      ],
    });

    const cart = await add(service, { options: PICKS });

    expect(cart.items[0]?.options?.map((l) => [l.name, l.qty, l.totalCents])).toEqual([
      ['M', 1, 0],
      ['Горячий', 1, 0],
      ['Овсяное', 1, 1000],
      ['Ваниль', 1, 800],
      ['Солёная карамель', 1, 800],
      ['Сахар', 2, 0],
    ]);
    expect(cart.subtotalCents).toBe(7100);
  });
});

describe('CartService with the options catalog — update', () => {
  function stored(patch: Record<string, unknown> = {}) {
    return {
      id: 'ci-1',
      cartId: 'cart-1',
      productId: 'p-cappuccino',
      quantity: 1,
      variationIds: [],
      modifiersJson: {},
      optionsJson: STORED,
      unitPriceCents: 7100,
      unitPrepSeconds: 180,
      notes: null,
      cart: { userId: 'user-1', storeId: 'store-1' },
      ...patch,
    };
  }

  it('keeps the picks on a quantity change, re-priced against the menu as it is now', async () => {
    const { prisma, service } = harness({ 'p-cappuccino': cappuccinoGroups(milk(1200)) });
    prisma.cartItem.findUnique.mockResolvedValue(stored());
    await service.updateItem('user-1', 'ci-1', { quantity: 3 });

    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: expect.objectContaining({ quantity: 3, optionsJson: STORED, unitPriceCents: 7300 }),
    });
  });

  it('never resets a line whose size has to be picked, nor refuses one that can no longer be made', async () => {
    // Nothing chosen would be OPTIONS_REQUIRED on add; a quantity change keeps the line's own size.
    const { prisma, service } = harness();
    prisma.cartItem.findUnique.mockResolvedValue(stored());
    await service.updateItem('user-1', 'ci-1', { quantity: 2 });
    expect(prisma.cartItem.update.mock.calls[0][0].data).toMatchObject({ quantity: 2, unitPriceCents: 7100 });

    // Oat milk ran out, or the product lost its groups: picks and price stay, checkout takes the line out.
    const menus: Array<Record<string, ProductOptionGroup[]>> = [
      { 'p-cappuccino': cappuccinoGroups(milk(1000, { available: false })) },
      {},
    ];
    for (const groups of menus) {
      const stopped = harness(groups);
      stopped.prisma.cartItem.findUnique.mockResolvedValue(stored());
      await stopped.service.updateItem('user-1', 'ci-1', { quantity: 4 });
      expect(stopped.prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'ci-1' },
        data: { quantity: 4, notes: null },
      });
    }
  });

  it('re-prices a new choice and refuses a broken one', async () => {
    const { prisma, service } = harness();
    prisma.cartItem.findUnique.mockResolvedValue(stored());
    const large = PICKS.map((p) => (p.optionId === 'oi_m' ? { optionId: 'oi_l', qty: 1 } : p));
    await service.updateItem('user-1', 'ci-1', { options: large });
    expect(prisma.cartItem.update.mock.calls[0][0].data.unitPriceCents).toBe(8100);

    const err = await rejectionOf(service.updateItem('user-1', 'ci-1', { options: [] }));
    expect(err.body).toMatchObject({ code: 'OPTIONS_INVALID' });
  });
});

describe('CartService with the options catalog — checkout', () => {
  type Row = CartItem & { product: StoreProduct };
  function row(patch: Partial<Row> = {}): Row {
    return {
      id: 'ci-1',
      cartId: 'cart-1',
      productId: 'p-cappuccino',
      quantity: 2,
      variationIds: [],
      modifiersJson: {},
      optionsJson: STORED,
      unitPriceCents: 7100,
      unitPrepSeconds: 180,
      notes: null,
      createdAt: new Date('2026-11-09T08:00:00Z'),
      updatedAt: new Date('2026-11-09T08:00:00Z'),
      product: cappuccino,
      ...patch,
    };
  }

  async function conflictOf(pending: Promise<unknown>): Promise<CartChangedException> {
    const err = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    if (!(err instanceof CartChangedException)) throw new Error(`expected a CartChangedException, got ${String(err)}`);
    return err;
  }

  it('hands the picks with names and prices to the order when nothing changed', async () => {
    const { prisma, service } = harness();
    const [line] = await service.repriceForCheckout({ id: 'cart-1', storeId: 'store-1', items: [row()] });

    expect(line).toMatchObject({ unitPriceCents: 7100, quantity: 2, variations: [], modifierLines: [] });
    expect(line?.optionLines).toEqual([
      expect.objectContaining({ groupName: 'Размер (кофе)', kind: 'VARIANT', name: 'M', totalCents: 0 }),
      expect.objectContaining({ name: 'Горячий' }),
      expect.objectContaining({ groupName: 'Молоко', kind: 'ADDON', type: 'A', name: 'Овсяное', totalCents: 1000 }),
      expect.objectContaining({ name: 'Ваниль', unitPriceCents: 800 }),
      expect.objectContaining({ name: 'Солёная карамель' }),
      expect.objectContaining({ type: 'C', name: 'Сахар', qty: 2, freeQty: 0, totalCents: 0 }),
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a new add-on price and leaves the new price and picks in the cart', async () => {
    const { prisma, service } = harness({ 'p-cappuccino': cappuccinoGroups(milk(1200)) });
    const err = await conflictOf(service.repriceForCheckout({ id: 'cart-1', storeId: 'store-1', items: [row()] }));

    expect(err.items).toEqual([
      expect.objectContaining({ reason: 'PRICE_CHANGED', previousUnitPriceCents: 7100, unitPriceCents: 7300 }),
    ]);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: expect.objectContaining({ unitPriceCents: 7300, optionsJson: STORED }),
    });
  });

  it.each([
    [
      'switched off by the brand',
      { 'p-cappuccino': cappuccinoGroups(group({ ...milk(), options: [milk().options[0]!] })) },
    ],
    ['stopped in the store', { 'p-cappuccino': cappuccinoGroups(milk(1000, { available: false })) }],
    ['detached with its group', { 'p-cappuccino': cappuccinoGroups().filter((g) => g.id !== 'og_milk') }],
    ['gone with every group', {}],
  ])('takes out a line whose oat milk was %s', async (_how, groups) => {
    const { prisma, service } = harness(groups);
    const err = await conflictOf(service.repriceForCheckout({ id: 'cart-1', storeId: 'store-1', items: [row()] }));

    expect(err.items).toEqual([expect.objectContaining({ reason: 'OPTION_UNAVAILABLE', unitPriceCents: null })]);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
  });

  it('takes out a line made with older options once the product moved to the catalog', async () => {
    const { service } = harness();
    const err = await conflictOf(
      service.repriceForCheckout({
        id: 'cart-1',
        storeId: 'store-1',
        items: [row({ optionsJson: [], variationIds: ['v-l'], modifiersJson: { 'm-shot': 1 } })],
      }),
    );
    expect(err.items).toEqual([expect.objectContaining({ reason: 'OPTION_UNAVAILABLE' })]);
  });
});
