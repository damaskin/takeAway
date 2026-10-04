import type { ConfigService } from '@nestjs/config';
import type { Modifier, Variation } from '@prisma/client';

import { CartChangedException } from '../cart/cart-changed.exception';
import { CartService, type PricedProduct } from '../cart/cart.service';
import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { DeliveryFeeService } from '../delivery/delivery-fee.service';
import type { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { MailService } from '../mail/mail.service';
import type { ReceiptPdfService } from '../mail/receipt-pdf.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PromoService } from '../promo/promo.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { ReferralsService } from '../referrals/referrals.service';
import { OrdersService } from './orders.service';

function variation(v: Partial<Variation> & Pick<Variation, 'id' | 'type' | 'name'>): Variation {
  return {
    productId: 'p-latte',
    priceDeltaCents: 0,
    prepTimeDeltaSeconds: 0,
    sortOrder: 0,
    isDefault: false,
    ingredientId: null,
    ...v,
  };
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
    ingredientId: null,
    ...m,
  };
}

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
      variation({ id: 'v-m', type: 'SIZE', name: 'M', sortOrder: 1, isDefault: true }),
      variation({ id: 'v-l', type: 'SIZE', name: 'L', priceDeltaCents: 140, sortOrder: 2 }),
      variation({ id: 'v-cow', type: 'MILK', name: 'Коровье', sortOrder: 1 }),
      variation({ id: 'v-oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 60, sortOrder: 2 }),
    ],
    modifiers: [modifier({ id: 'm-vanilla', name: 'Ваниль', priceDeltaCents: 50 })],
    ...overrides,
  };
}

/** Two "L, oat, +2 vanilla" lattes, as the customer put them in the cart. */
function cartWith(product: PricedProduct) {
  return {
    id: 'cart-1',
    userId: 'user-1',
    storeId: 'store-1',
    subtotalCents: 1500,
    etaSeconds: 600,
    createdAt: new Date('2026-09-23T08:00:00Z'),
    updatedAt: new Date('2026-09-23T08:00:00Z'),
    store: {
      id: 'store-1',
      brandId: 'brand-a',
      currency: 'MDL',
      minOrderCents: 0,
      taxRateBps: 0,
      taxIncludedInPrice: true,
      fulfillmentTypes: ['TAKEAWAY'],
    },
    items: [
      {
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
        product,
      },
    ],
  };
}

/** What `productSnapshot` looks like for the latte above since options were snapshotted. */
const LATTE_SNAPSHOT = {
  id: 'p-latte',
  slug: 'latte',
  name: 'Латте',
  variationIds: ['v-l', 'v-oat'],
  modifiers: { 'm-vanilla': 2 },
  notes: 'поменьше пены',
  unitPrepSeconds: 180,
  variations: [
    { id: 'v-l', type: 'SIZE', name: 'L', priceDeltaCents: 140 },
    { id: 'v-oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 60 },
  ],
  modifierLines: [{ id: 'm-vanilla', name: 'Ваниль', count: 2, priceCents: 50 }],
};

/** Written before options were snapshotted: ids only. */
const LEGACY_SNAPSHOT = {
  id: 'p-latte',
  slug: 'latte',
  name: 'Латте',
  variationIds: ['v-l', 'v-oat'],
  modifiers: { 'm-vanilla': 2 },
  notes: null,
  unitPrepSeconds: 180,
};

function harness() {
  const tx = {
    order: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: Record<string, unknown> & { items: { create: Array<Record<string, unknown>> } };
        }) => ({
          ...data,
          id: 'order-1',
          createdAt: new Date('2026-09-23T08:01:00Z'),
          acceptedAt: null,
          startedAt: null,
          readyAt: null,
          pickedUpAt: null,
          cancelledAt: null,
          expiredAt: null,
          outForDeliveryAt: null,
          deliveredAt: null,
          riderId: null,
          items: data.items.create.map((item, i) => ({ id: `oi-${i}`, orderId: 'order-1', ...item })),
          store: { name: 'Кофейня на углу' },
        }),
      ),
    },
    cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    cart: { update: jest.fn().mockResolvedValue({}) },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    cart: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    store: {
      findUnique: jest.fn().mockResolvedValue({
        brandId: 'brand-a',
        status: 'OPEN',
        brand: { moderationStatus: 'APPROVED' },
        shifts: [{ id: 'shift-1' }],
      }),
    },
    stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Иван Петров' }) },
    order: { findUnique: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    // The order is written in an interactive transaction; the cart fix-up in
    // a batch one.
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  const kitchen = {
    timings: jest.fn().mockReturnValue({ prepSeconds: 180, workSeconds: 360 }),
    quote: jest.fn().mockResolvedValue({ etaSeconds: 600 }),
    assertOpenAt: jest.fn().mockResolvedValue(undefined),
    assertSlotAvailable: jest.fn().mockResolvedValue(undefined),
  };
  const mail = { sendOrderReceipt: jest.fn().mockResolvedValue(undefined), sendWelcome: jest.fn() };
  const receiptPdf = { render: jest.fn().mockResolvedValue(null) };
  const loyalty = { quoteRedemption: jest.fn().mockResolvedValue({ points: 0, discountCents: 0 }) };
  const notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };
  const realtime = { emitKdsOrderChanged: jest.fn() };
  // Card payments off unless a test says otherwise.
  const holds = { cardPaymentRequired: jest.fn().mockReturnValue(false) };

  const cart = new CartService(prisma as unknown as PrismaService, kitchen as unknown as KitchenLoadService);
  const service = new OrdersService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    {} as PromoService,
    loyalty as unknown as LoyaltyService,
    {} as ConfigService,
    notifications as unknown as NotificationsService,
    { deliveryEnabled: false } as FeatureFlagsService,
    {} as DeliveryFeeService,
    mail as unknown as MailService,
    receiptPdf as unknown as ReceiptPdfService,
    {} as GiftCardsService,
    {} as ReferralsService,
    kitchen as unknown as KitchenLoadService,
    cart,
    holds as unknown as PaymentHoldsService,
  );

  return { service, prisma, tx, mail, realtime, holds, kitchen };
}

const placeOrder = { cartId: 'cart-1', pickupMode: 'ASAP' as const };

describe('OrdersService.create', () => {
  it('freezes the chosen size, milk, extras and notes into the order line', async () => {
    const { service, prisma, tx } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));

    const order = await service.create('user-1', placeOrder);

    const created = tx.order.create.mock.calls[0]?.[0];
    expect(created?.data.items.create).toHaveLength(1);
    expect(created?.data.items.create[0]).toEqual({
      productSnapshot: LATTE_SNAPSHOT,
      quantity: 2,
      unitPriceCents: 750,
      totalCents: 1500,
    });
    expect(order.subtotalCents).toBe(1500);
    expect(order.items[0]?.productSnapshot).toEqual(LATTE_SNAPSHOT);
  });

  // A card order waits on the board as CREATED with a hold until the kitchen
  // accepts it, so the PAID-time push never fires for it; without this one
  // the kitchen learnt about the order only on its next poll.
  it('refuses the order while nobody has started a shift at the store', async () => {
    const { service, prisma, tx } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));
    prisma.store.findUnique.mockResolvedValueOnce({
      brandId: 'brand-a',
      status: 'OPEN',
      brand: { moderationStatus: 'APPROVED' },
      shifts: [],
    });

    await expect(service.create('user-1', placeOrder)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'STORE_NOT_TAKING_ORDERS' }),
    });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  // The shift is the source of truth for "open now": staff at work take an
  // ASAP order even after the posted closing time.
  it('takes an ASAP order during a shift even outside the working hours', async () => {
    const { service, prisma, tx, kitchen } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));
    kitchen.assertOpenAt.mockRejectedValue(new Error('closed at that time'));

    await service.create('user-1', placeOrder);

    expect(kitchen.assertOpenAt).not.toHaveBeenCalled();
    expect(tx.order.create).toHaveBeenCalled();
  });

  it('still holds a scheduled pickup to the working hours', async () => {
    const { service, prisma, tx, kitchen } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));
    kitchen.assertOpenAt.mockRejectedValue(new Error('closed at that time'));
    const pickupAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await expect(service.create('user-1', { cartId: 'cart-1', pickupMode: 'SCHEDULED', pickupAt })).rejects.toThrow(
      'closed at that time',
    );
    expect(kitchen.assertOpenAt).toHaveBeenCalledWith('store-1', pickupAt);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('announces the new order to the store kitchen right away', async () => {
    const { service, prisma, realtime } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));

    await service.create('user-1', placeOrder);

    expect(realtime.emitKdsOrderChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'created',
        orderId: 'order-1',
        order: expect.objectContaining({
          id: 'order-1',
          status: 'CREATED',
          items: [{ productSnapshot: LATTE_SNAPSHOT, quantity: 2 }],
        }),
      }),
    );
  });

  it('keeps an order that has to be paid by card off the kitchen board until its hold is in place', async () => {
    const { service, prisma, realtime, holds } = harness();
    holds.cardPaymentRequired.mockReturnValue(true);
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));

    await service.create('user-1', placeOrder);

    expect(realtime.emitKdsOrderChanged).not.toHaveBeenCalled();
  });

  it('keeps the name the customer gave at checkout', async () => {
    const { service, prisma, tx } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));

    await service.create('user-1', { ...placeOrder, customerName: '  Аня ' });

    expect(tx.order.create.mock.calls[0]?.[0].data['customerName']).toBe('Аня');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  // A signed-in customer whose checkout sent no name showed up as «Без имени»
  // in the admin and «Клиент» on the kitchen board.
  it('names the order after the customer’s profile when checkout sent no name', async () => {
    const { service, prisma, tx } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));

    const order = await service.create('user-1', { ...placeOrder, customerName: '   ' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { name: true } });
    expect(tx.order.create.mock.calls[0]?.[0].data['customerName']).toBe('Иван Петров');
    expect(order.customerName).toBe('Иван Петров');
  });

  it('leaves the name empty when neither checkout nor the profile has one', async () => {
    const { service, prisma, tx } = harness();
    prisma.cart.findUnique.mockResolvedValue(cartWith(latte()));
    prisma.user.findUnique.mockResolvedValue({ name: null });

    await service.create('user-1', placeOrder);

    expect(tx.order.create.mock.calls[0]?.[0].data['customerName']).toBeNull();
  });

  it('charges the menu price of today, not the one the cart remembered', async () => {
    const { service, prisma, tx } = harness();
    // The admin fixed a wrong base price after the latte went in the cart.
    prisma.cart.findUnique
      .mockResolvedValueOnce(cartWith(latte({ basePriceCents: 500 })))
      .mockResolvedValue({ ...cartWith(latte()), items: [] });

    await expect(service.create('user-1', placeOrder)).rejects.toBeInstanceOf(CartChangedException);

    expect(tx.order.create).not.toHaveBeenCalled();
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: expect.objectContaining({ unitPriceCents: 800 }),
    });
  });

  it('answers 409 with a machine-readable code when a chosen milk was deleted', async () => {
    const { service, prisma, tx } = harness();
    const product = latte();
    product.variations = product.variations.filter((v) => v.id !== 'v-oat');
    prisma.cart.findUnique
      .mockResolvedValueOnce(cartWith(product))
      .mockResolvedValue({ ...cartWith(product), items: [] });

    const err = await service.create('user-1', placeOrder).then(
      () => null,
      (e: unknown) => e,
    );

    if (!(err instanceof CartChangedException)) throw new Error(`expected a CartChangedException, got ${err}`);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({
      code: 'CART_CHANGED',
      message: 'Цены или состав меню изменились — проверьте корзину',
      items: [{ cartItemId: 'ci-1', productName: 'Латте', reason: 'OPTION_UNAVAILABLE', unitPriceCents: null }],
    });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ci-1'] } } });
  });
});

describe('OrdersService order detail and receipt', () => {
  function storedOrder(snapshots: unknown[]) {
    return {
      id: 'order-1',
      orderCode: '4832',
      status: 'PAID',
      fulfillmentType: 'PICKUP',
      pickupMode: 'ASAP',
      pickupAt: new Date('2026-09-23T08:15:00Z'),
      createdAt: new Date('2026-09-23T08:01:00Z'),
      storeId: 'store-1',
      userId: 'user-1',
      customerName: null,
      customerPhone: null,
      notes: null,
      currency: 'MDL',
      subtotalCents: 1500,
      discountCents: 0,
      taxCents: 0,
      deliveryFeeCents: 0,
      giftCardCents: 0,
      totalCents: 1500,
      couponCode: null,
      giftCardCode: null,
      items: snapshots.map((productSnapshot, i) => ({
        id: `oi-${i}`,
        productSnapshot,
        quantity: 2,
        unitPriceCents: 750,
        totalCents: 1500,
      })),
      payments: [],
      events: [],
      store: { name: 'Кофейня на углу', taxIncludedInPrice: true },
      user: { email: 'guest@example.com', name: null },
    };
  }

  it('shows the admin what each line was made with, and old orders by name alone', async () => {
    const { service, prisma } = harness();
    prisma.order.findUnique.mockResolvedValue(storedOrder([LATTE_SNAPSHOT, LEGACY_SNAPSHOT]));

    const detail = await service.getForAdmin('order-1');

    expect(detail.items[0]).toMatchObject({
      name: 'Латте',
      variations: [{ name: 'L' }, { name: 'Овсяное' }],
      modifierLines: [{ name: 'Ваниль', count: 2 }],
      notes: 'поменьше пены',
    });
    expect(detail.items[1]).toMatchObject({ name: 'Латте', variations: [], modifierLines: [], notes: null });
  });

  it('shows the admin how far the customer was, never where', async () => {
    const { service, prisma } = harness();
    const stored = storedOrder([LATTE_SNAPSHOT]);
    const at = new Date('2026-09-23T08:10:00Z');
    stored.events = [
      { id: 'ev-1', type: 'STATUS_CHANGED', createdAt: at, actorId: null, payload: { from: 'CREATED', to: 'PAID' } },
      {
        id: 'ev-2',
        type: 'CUSTOMER_NEARBY',
        createdAt: at,
        actorId: 'user-1',
        payload: { distanceM: 180.4, lat: 46.84, lng: 29.63 },
      },
      {
        id: 'ev-3',
        type: 'CUSTOMER_HERE',
        createdAt: at,
        actorId: 'user-1',
        payload: { distanceM: 12.1, lat: 46.841, lng: 29.631 },
      },
      { id: 'ev-4', type: 'NOTE', createdAt: at, actorId: null, payload: null },
    ] as never[];
    prisma.order.findUnique.mockResolvedValue(stored);

    const detail = await service.getForAdmin('order-1');

    expect(detail.events.map((e) => e.payload)).toEqual([
      { from: 'CREATED', to: 'PAID' },
      { distanceM: 180.4 },
      { distanceM: 12.1 },
      null,
    ]);
    expect(JSON.stringify(detail)).not.toMatch(/"(lat|lng)"/);
  });

  it('prints the options under each line of the receipt', async () => {
    const { service, prisma, mail } = harness();
    prisma.order.findUnique.mockResolvedValue(storedOrder([LATTE_SNAPSHOT, LEGACY_SNAPSHOT]));

    await service.sendPaymentMail('order-1');

    const receipt = mail.sendOrderReceipt.mock.calls[0]?.[1] as { items: unknown[] } | undefined;
    expect(receipt?.items).toEqual([
      { name: 'Латте', options: 'L · Овсяное · +Ваниль ×2', quantity: 2, totalCents: 1500 },
      { name: 'Латте', options: '', quantity: 2, totalCents: 1500 },
    ]);
  });
});
