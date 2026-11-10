import type { ConfigService } from '@nestjs/config';

import { CartService, type StoreProduct } from '../cart/cart.service';
import { optionGroupsStub } from '../option-groups/testing/option-groups.stub';
import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { DeliveryFeeService } from '../delivery/delivery-fee.service';
import type { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { QueuePolicyService } from '../kitchen/queue-policy.service';
import type { StoreAvailabilityService, StoreAvailabilityView } from '../kitchen/store-availability.service';
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
import type { QueueRecomputeService } from './queue-recompute.service';
import type { TakeawayPromoService } from '../takeaway-promos/takeaway-promo.service';

const at = (iso: string) => new Date(iso);

/** An americano of 3 minutes, no options; a cola that is made alongside. */
function product(id: string, prepTimeSeconds: number, prepParallel: boolean): StoreProduct {
  return {
    id,
    brandId: 'brand-a',
    categoryId: 'cat-coffee',
    slug: id,
    name: id,
    description: null,
    basePriceCents: 300,
    prepTimeSeconds,
    prepParallel,
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
    createdAt: at('2026-09-01T00:00:00Z'),
    updatedAt: at('2026-09-01T00:00:00Z'),
    stores: [{ storeId: 'store-1' }],
    category: { visible: true, addOnsOnly: false },
    variations: [],
    modifiers: [],
  };
}

function line(p: StoreProduct, quantity: number) {
  return {
    id: `ci-${p.id}`,
    cartId: 'cart-1',
    productId: p.id,
    quantity,
    variationIds: [],
    modifiersJson: {},
    optionsJson: [],
    unitPriceCents: 300,
    unitPrepSeconds: p.prepTimeSeconds,
    notes: null,
    createdAt: at('2026-11-09T11:59:00Z'),
    updatedAt: at('2026-11-09T11:59:00Z'),
    product: p,
  };
}

const CART = {
  id: 'cart-1',
  userId: 'user-1',
  storeId: 'store-1',
  subtotalCents: 900,
  etaSeconds: 0,
  createdAt: at('2026-11-09T11:59:00Z'),
  updatedAt: at('2026-11-09T11:59:00Z'),
  store: {
    id: 'store-1',
    brandId: 'brand-a',
    status: 'OVERLOADED',
    currency: 'MDL',
    minOrderCents: 0,
    taxRateBps: 0,
    taxIncludedInPrice: true,
    fulfillmentTypes: ['TAKEAWAY'],
  },
  items: [line(product('p-americano', 180, false), 2), line(product('p-cola', 60, true), 1)],
};

function harness() {
  const steps: string[] = [];
  const tx = {
    order: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> & { items: { create: unknown[] } } }) => {
        steps.push('create');
        return {
          ...data,
          id: 'order-1',
          createdAt: at('2026-11-09T12:00:00Z'),
          items: (data.items.create as Array<Record<string, unknown>>).map((item, i) => ({ id: `oi-${i}`, ...item })),
          store: { name: 'Центр' },
        };
      }),
    },
    cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    cart: { update: jest.fn().mockResolvedValue({}) },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    cart: { findUnique: jest.fn().mockResolvedValue(CART) },
    store: {
      findUnique: jest.fn().mockResolvedValue({ brandId: 'brand-a', brand: { moderationStatus: 'APPROVED' } }),
    },
    stopListEntry: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Иван' }) },
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        orderCode: '1234',
        status: 'CREATED',
        pickupMode: 'ASAP',
        pickupAt: at('2026-11-09T12:21:00Z'),
        createdAt: at('2026-11-09T12:00:00Z'),
        customerName: 'Иван',
        notes: null,
        prepSeconds: 180,
        workSeconds: 420,
        kitchenVisibleAt: at('2026-11-09T12:00:00Z'),
        events: [],
        items: [],
        store: { kitchenParallelism: 1, baseEtaSeconds: 300 },
      }),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const view: StoreAvailabilityView & { brandId: string; status: string } = {
    acceptingOrders: true,
    openNow: true,
    asapBlockedReason: null,
    opensAt: null,
    closesAt: at('2026-11-09T20:00:00Z'),
    withinHours: true,
    extendedUntil: null,
    pausedUntil: null,
    pauseReason: null,
    currentEtaSeconds: 600,
    brandId: 'brand-a',
    status: 'OPEN',
  };
  const availability = { forStore: jest.fn().mockResolvedValue(view) };
  const kitchen = {
    timings: jest.fn().mockReturnValue({ prepSeconds: 180, workSeconds: 420 }),
    quote: jest.fn(),
    assertScheduledSlot: jest.fn(),
  };
  const quote = (iso: string) => ({ readyAt: at(iso), etaSeconds: 0, quote: {} });
  const queue = {
    enabled: true,
    maxAsapWaitSeconds: 2700,
    quoteBasket: jest
      .fn()
      .mockResolvedValueOnce(quote('2026-11-09T12:16:00Z'))
      .mockResolvedValueOnce(quote('2026-11-09T12:21:00Z')),
    assertPreorderTime: jest.fn().mockResolvedValue(undefined),
    lockStore: jest.fn(async () => {
      steps.push('lock');
    }),
    plans: jest
      .fn()
      .mockResolvedValue(
        new Map([
          ['order-1', { startAt: Date.parse('2026-11-09T12:15:00Z'), readyAt: Date.parse('2026-11-09T12:21:00Z') }],
        ]),
      ),
  };
  const recompute = { touch: jest.fn() };
  const realtime = { emitKdsOrderChanged: jest.fn() };
  const holds = { cardPaymentRequired: jest.fn().mockReturnValue(false) };

  const cart = new CartService(
    prisma as unknown as PrismaService,
    kitchen as unknown as KitchenLoadService,
    availability as unknown as StoreAvailabilityService,
    optionGroupsStub(),
  );
  const service = new OrdersService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    {} as PromoService,
    { quoteRedemption: jest.fn().mockResolvedValue({ points: 0, discountCents: 0 }) } as unknown as LoyaltyService,
    { get: jest.fn() } as unknown as ConfigService,
    { notifyOrderStatus: jest.fn() } as unknown as NotificationsService,
    { deliveryEnabled: false, queuePolicyEnabled: true } as FeatureFlagsService,
    {} as DeliveryFeeService,
    { sendOrderReceipt: jest.fn() } as unknown as MailService,
    { render: jest.fn() } as unknown as ReceiptPdfService,
    {} as GiftCardsService,
    {} as ReferralsService,
    kitchen as unknown as KitchenLoadService,
    cart,
    holds as unknown as PaymentHoldsService,
    {} as TakeawayPromoService,
    queue as unknown as QueuePolicyService,
    recompute as unknown as QueueRecomputeService,
  );
  const storeIs = (patch: Partial<typeof view>) => availability.forStore.mockResolvedValue({ ...view, ...patch });
  return { service, tx, queue, kitchen, recompute, realtime, steps, storeIs };
}

describe('OrdersService.create under the queue policy', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: at('2026-11-09T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  it('promises an order for now the G it gets in the queue under the store lock, not the earlier check', async () => {
    const { service, tx, queue, kitchen, steps } = harness();

    await service.create('user-1', { cartId: 'cart-1', pickupMode: 'ASAP' });

    expect(kitchen.quote).not.toHaveBeenCalled();
    expect(steps).toEqual(['lock', 'create']);
    expect(queue.lockStore).toHaveBeenCalledWith(tx, 'store-1');
    // The second quote is the one inside the transaction, read through it.
    expect(queue.quoteBasket.mock.calls[1]?.[3]).toBe(tx);
    const data = tx.order.create.mock.calls[0]?.[0]?.data;
    expect(data?.['pickupAt']).toEqual(at('2026-11-09T12:21:00Z'));
    expect(data?.['placedUnderLoad']).toBe(true);
  });

  it('snapshots B and «Готовится параллельно» of each line from its product, the options left out', async () => {
    const { service, tx, queue } = harness();

    await service.create('user-1', { cartId: 'cart-1', pickupMode: 'ASAP' });

    const basket = [
      { prepSeconds: 180, parallel: false, quantity: 2 },
      { prepSeconds: 60, parallel: true, quantity: 1 },
    ];
    expect(queue.quoteBasket.mock.calls[0]?.[1]).toEqual(basket);
    const items = tx.order.create.mock.calls[0]?.[0]?.data.items.create as Array<Record<string, unknown>>;
    expect(items.map((i) => [i['prepSeconds'], i['prepParallel']])).toEqual([
      [180, false],
      [60, true],
    ]);
  });

  it('refuses an order for now that would be ready after the closing, or past the longest wait', async () => {
    const closing = harness();
    closing.storeIs({ closesAt: at('2026-11-09T12:15:00Z') });
    await expect(closing.service.create('user-1', { cartId: 'cart-1', pickupMode: 'ASAP' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ASAP_UNAVAILABLE',
        reason: 'CLOSING_SOON',
        closesAt: '2026-11-09T12:15:00.000Z',
      }),
    });
    expect(closing.tx.order.create).not.toHaveBeenCalled();

    const full = harness();
    full.queue.quoteBasket.mockReset().mockResolvedValue({ readyAt: at('2026-11-09T12:46:00Z') });
    await expect(full.service.create('user-1', { cartId: 'cart-1', pickupMode: 'ASAP' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ASAP_UNAVAILABLE', reason: 'QUEUE_FULL' }),
    });
  });

  it("refuses an order for now with the store's own reason first", async () => {
    const { service, storeIs, queue } = harness();
    storeIs({ openNow: false, asapBlockedReason: 'PAUSED', pausedUntil: at('2026-11-09T12:30:00Z') });
    await expect(service.create('user-1', { cartId: 'cart-1', pickupMode: 'ASAP' })).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'PAUSED', pausedUntil: '2026-11-09T12:30:00.000Z' }),
    });
    expect(queue.quoteBasket).not.toHaveBeenCalled();
  });

  it('checks a pre-order time before and again under the lock, through the transaction', async () => {
    const { service, tx, queue, kitchen, steps } = harness();
    const pickupAt = at('2026-11-09T13:30:00Z');

    await service.create('user-1', { cartId: 'cart-1', pickupMode: 'SCHEDULED', pickupAt });

    expect(kitchen.assertScheduledSlot).not.toHaveBeenCalled();
    expect(queue.assertPreorderTime).toHaveBeenCalledTimes(2);
    expect(queue.assertPreorderTime.mock.calls[1]?.[4]).toBe(tx);
    expect(steps).toEqual(['lock', 'create']);
    expect(tx.order.create.mock.calls[0]?.[0]?.data['pickupAt']).toEqual(pickupAt);
  });

  it('books nothing when the time was taken while the customer paid', async () => {
    const { service, tx, queue } = harness();
    const taken = Object.assign(new Error('taken'), { response: { code: 'PICKUP_SLOT_FULL' } });
    queue.assertPreorderTime.mockResolvedValueOnce(undefined).mockRejectedValueOnce(taken);

    await expect(
      service.create('user-1', { cartId: 'cart-1', pickupMode: 'SCHEDULED', pickupAt: at('2026-11-09T13:30:00Z') }),
    ).rejects.toBe(taken);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it("recomputes the store's estimates and shows the queue's times on the new ticket", async () => {
    const { service, recompute, realtime } = harness();

    await service.create('user-1', { cartId: 'cart-1', pickupMode: 'ASAP' });

    expect(recompute.touch).toHaveBeenCalledWith('store-1');
    expect(realtime.emitKdsOrderChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          startBy: '2026-11-09T12:15:00.000Z',
          plannedReadyAt: '2026-11-09T12:21:00.000Z',
        }),
      }),
    );
  });
});

describe('the order DTO under the queue policy', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: at('2026-11-09T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => jest.useRealTimers());

  it('says its ready time comes from the queue, so the clients show «Готов в 12:11 · ≈ 11 мин»', async () => {
    const { service } = harness();
    const order = await service.create('user-1', { cartId: 'cart-1', pickupMode: 'ASAP' });
    expect(order.readyFromQueue).toBe(true);
  });
});
