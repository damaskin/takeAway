import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type PaymentStatus } from '@prisma/client';

import type { CartService } from '../cart/cart.service';
import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { DeliveryFeeService } from '../delivery/delivery-fee.service';
import type { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { MailService } from '../mail/mail.service';
import type { ReceiptPdfService } from '../mail/receipt-pdf.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { OrdersService, canCustomerReview } from '../orders/orders.service';
import type { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PromoService } from '../promo/promo.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { ReferralsService } from '../referrals/referrals.service';
import { OrderReviewsService } from './order-reviews.service';
import type { TakeawayPromoService } from '../takeaway-promos/takeaway-promo.service';

/**
 * «Отзыв на покупку» (Maxim's list 5.0, item 11): 1–5 stars and a comment on
 * the order screen once the order is handed over; only takeAway reads them.
 */

const at = (iso: string) => new Date(iso);

/** What the review reads first: whose order, where it stands, whether it has a review. */
function lookup(patch: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    status: 'PICKED_UP',
    storeId: 'store-1',
    store: { brandId: 'brand-1' },
    review: null,
    ...patch,
  };
}

/** The order as the customer's screen reads it back. */
function orderRow(patch: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    storeId: 'store-1',
    orderCode: '1234',
    status: 'PICKED_UP',
    fulfillmentType: 'PICKUP',
    pickupMode: 'ASAP',
    pickupAt: at('2026-11-06T09:15:00Z'),
    qrToken: 'qr',
    subtotalCents: 4500,
    discountCents: 0,
    taxCents: 0,
    totalCents: 4500,
    currency: 'RUP',
    customerName: 'Аня',
    customerPhone: null,
    notes: null,
    couponCode: null,
    giftCardCode: null,
    giftCardCents: 0,
    createdAt: at('2026-11-06T09:00:00Z'),
    acceptedAt: at('2026-11-06T09:01:00Z'),
    startedAt: null,
    readyAt: at('2026-11-06T09:12:00Z'),
    pickedUpAt: at('2026-11-06T09:16:00Z'),
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    cancelComment: null,
    expiredAt: null,
    readyEstimateAt: null,
    deliveryAddressLine: null,
    deliveryCity: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    deliveryNotes: null,
    deliveryFeeCents: 0,
    deliveryDistanceM: null,
    riderId: null,
    outForDeliveryAt: null,
    deliveredAt: null,
    items: [],
    store: { name: 'Центр', latitude: 0, longitude: 0, addressLine: null, timezone: 'UTC' },
    payments: [{ status: 'SUCCEEDED' as PaymentStatus, amountCents: 4500, updatedAt: at('2026-11-06T09:01:00Z') }],
    review: null,
    ...patch,
  };
}

function harness() {
  const prisma = {
    order: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    orderReview: {
      create: jest.fn().mockResolvedValue({ id: 'rev-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const orders = new OrdersService(
    prisma as unknown as PrismaService,
    {} as RealtimeGateway,
    {} as PromoService,
    {} as LoyaltyService,
    {} as ConfigService,
    {} as NotificationsService,
    {} as FeatureFlagsService,
    {} as DeliveryFeeService,
    {} as MailService,
    {} as ReceiptPdfService,
    {} as GiftCardsService,
    {} as ReferralsService,
    {} as KitchenLoadService,
    {} as CartService,
    {} as PaymentHoldsService,
    {} as TakeawayPromoService,
  );
  const service = new OrderReviewsService(prisma as unknown as PrismaService, orders);
  return { service, orders, prisma };
}

const reviewedAt = at('2026-11-06T09:30:00Z');

describe('OrderReviewsService.create', () => {
  it('keeps the stars and the trimmed comment with the brand and the store, and answers with the reviewed order', async () => {
    const { service, prisma } = harness();
    prisma.order.findUnique
      .mockResolvedValueOnce(lookup())
      .mockResolvedValueOnce(orderRow({ review: { rating: 4, comment: 'Вкусно', createdAt: reviewedAt } }));

    const dto = await service.create('user-1', 'order-1', { rating: 4, comment: '  Вкусно  ' });

    expect(prisma.orderReview.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        userId: 'user-1',
        brandId: 'brand-1',
        storeId: 'store-1',
        rating: 4,
        comment: 'Вкусно',
      },
      select: { id: true },
    });
    expect(dto).toMatchObject({
      id: 'order-1',
      canReview: false,
      review: { rating: 4, comment: 'Вкусно', createdAt: reviewedAt.toISOString() },
    });
  });

  it('keeps no comment when the customer left only the stars', async () => {
    const { service, prisma } = harness();
    prisma.order.findUnique.mockResolvedValueOnce(lookup()).mockResolvedValueOnce(orderRow());

    await service.create('user-1', 'order-1', { rating: 5 });

    expect(prisma.orderReview.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rating: 5, comment: null }) }),
    );
  });

  it('takes a review of a delivered order', async () => {
    const { service, prisma } = harness();
    prisma.order.findUnique
      .mockResolvedValueOnce(lookup({ status: 'DELIVERED' }))
      .mockResolvedValueOnce(orderRow({ status: 'DELIVERED' }));

    await service.create('user-1', 'order-1', { rating: 3 });

    expect(prisma.orderReview.create).toHaveBeenCalled();
  });

  it.each(['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'OUT_FOR_DELIVERY', 'CANCELLED', 'EXPIRED'])(
    'refuses a %s order with 409 ORDER_NOT_REVIEWABLE',
    async (status) => {
      const { service, prisma } = harness();
      prisma.order.findUnique.mockResolvedValueOnce(lookup({ status }));

      const err = await service.create('user-1', 'order-1', { rating: 5 }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ORDER_NOT_REVIEWABLE' });
      expect(prisma.orderReview.create).not.toHaveBeenCalled();
    },
  );

  it('refuses a second review with 409 ORDER_ALREADY_REVIEWED — a review is not edited', async () => {
    const { service, prisma } = harness();
    prisma.order.findUnique.mockResolvedValueOnce(lookup({ review: { id: 'rev-1' } }));

    const err = await service.create('user-1', 'order-1', { rating: 1 }).catch((e: unknown) => e);

    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ORDER_ALREADY_REVIEWED' });
    expect(prisma.orderReview.create).not.toHaveBeenCalled();
  });

  it('answers ORDER_ALREADY_REVIEWED when two sends race and the database keeps the first', async () => {
    const { service, prisma } = harness();
    prisma.order.findUnique.mockResolvedValueOnce(lookup());
    prisma.orderReview.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );

    const err = await service.create('user-1', 'order-1', { rating: 5 }).catch((e: unknown) => e);

    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ORDER_ALREADY_REVIEWED' });
  });

  it("answers 404 for somebody else's order and for no order at all", async () => {
    const { service, prisma } = harness();
    prisma.order.findUnique.mockResolvedValueOnce(lookup({ userId: 'user-2' })).mockResolvedValueOnce(null);

    await expect(service.create('user-1', 'order-1', { rating: 5 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create('user-1', 'nope', { rating: 5 })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.orderReview.create).not.toHaveBeenCalled();
  });
});

describe("the customer's order and history", () => {
  it('offers a review of a picked-up order until there is one, then shows it back', async () => {
    const { orders, prisma } = harness();
    prisma.order.findUnique
      .mockResolvedValueOnce(orderRow())
      .mockResolvedValueOnce(orderRow({ review: { rating: 2, comment: null, createdAt: reviewedAt } }));

    expect(await orders.getForUser('user-1', 'order-1')).toMatchObject({ canReview: true, review: null });
    expect(await orders.getForUser('user-1', 'order-1')).toMatchObject({
      canReview: false,
      review: { rating: 2, comment: null, createdAt: reviewedAt.toISOString() },
    });
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ review: { select: { rating: true, comment: true, createdAt: true } } }),
      }),
    );
  });

  it('offers none before the handover, nor for a cancelled or expired order', async () => {
    const { orders, prisma } = harness();
    for (const status of ['READY', 'CANCELLED', 'EXPIRED']) {
      prisma.order.findUnique.mockResolvedValueOnce(orderRow({ status }));
      expect(await orders.getForUser('user-1', 'order-1')).toMatchObject({ canReview: false, review: null });
    }
  });

  it('tells the order history which orders can be reviewed and the stars already given', async () => {
    const { orders, prisma } = harness();
    prisma.order.findMany.mockResolvedValue([
      { ...orderRow({ id: 'o-1' }), items: [{ quantity: 1 }], review: null },
      { ...orderRow({ id: 'o-2' }), items: [{ quantity: 1 }], review: { rating: 5 } },
      { ...orderRow({ id: 'o-3', status: 'CANCELLED' }), items: [{ quantity: 1 }], review: null },
    ]);

    const list = await orders.listForUser('user-1', 20, 'HISTORY');

    expect(list.map((o) => [o.id, o.canReview, o.reviewRating])).toEqual([
      ['o-1', true, null],
      ['o-2', false, 5],
      ['o-3', false, null],
    ]);
  });

  it('canCustomerReview: only PICKED_UP or DELIVERED, and only once', () => {
    expect(canCustomerReview({ status: 'PICKED_UP', review: null })).toBe(true);
    expect(canCustomerReview({ status: 'DELIVERED' })).toBe(true);
    expect(canCustomerReview({ status: 'PICKED_UP', review: { rating: 3 } })).toBe(false);
    expect(canCustomerReview({ status: 'READY', review: null })).toBe(false);
    expect(canCustomerReview({ status: 'CANCELLED', review: null })).toBe(false);
  });
});

describe('OrderReviewsService.list', () => {
  function row(patch: Record<string, unknown> = {}) {
    return {
      id: 'rev-1',
      rating: 4,
      comment: 'Вкусно',
      createdAt: reviewedAt,
      order: { id: 'order-1', orderCode: '1234', customerName: 'Анна' },
      brand: { id: 'brand-1', name: 'NoName Coffee' },
      store: { id: 'store-1', name: 'Центр' },
      user: {
        id: 'user-1',
        name: 'Аня',
        email: 'ana@example.com',
        phone: '+37377700000',
        telegramUserId: BigInt(777000111),
        blockedAt: null,
      },
      ...patch,
    };
  }

  it('lists newest first with the brand, the store, the order and the customer', async () => {
    const { service, prisma } = harness();
    prisma.orderReview.findMany.mockResolvedValue([row()]);
    prisma.orderReview.count.mockResolvedValue(1);

    const page = await service.list({});

    expect(prisma.orderReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 25 }),
    );
    expect(page.items).toEqual([
      {
        id: 'rev-1',
        rating: 4,
        comment: 'Вкусно',
        createdAt: reviewedAt.toISOString(),
        orderId: 'order-1',
        orderCode: '1234',
        brand: { id: 'brand-1', name: 'NoName Coffee' },
        store: { id: 'store-1', name: 'Центр' },
        customer: {
          id: 'user-1',
          name: 'Аня',
          email: 'ana@example.com',
          phone: '+37377700000',
          telegramUserId: '777000111',
          deleted: false,
        },
      },
    ]);
  });

  it('shows a deleted account as deleted, with no name or contacts left', async () => {
    const { service, prisma } = harness();
    prisma.orderReview.findMany.mockResolvedValue([
      row({
        order: { id: 'order-1', orderCode: '1234', customerName: null },
        user: {
          id: 'user-1',
          name: null,
          email: null,
          phone: null,
          telegramUserId: null,
          blockedAt: at('2026-11-06T10:00:00Z'),
        },
      }),
    ]);

    const page = await service.list({});

    expect(page.items[0]).toMatchObject({
      rating: 4,
      comment: 'Вкусно',
      customer: { id: 'user-1', name: null, email: null, phone: null, telegramUserId: null, deleted: true },
    });
  });

  it('falls back to the name given at checkout when the account has none', async () => {
    const { service, prisma } = harness();
    prisma.orderReview.findMany.mockResolvedValue([
      row({ user: { ...row().user, name: null }, order: { id: 'order-1', orderCode: '1234', customerName: 'Гость' } }),
    ]);

    const page = await service.list({});

    expect(page.items[0]?.customer.name).toBe('Гость');
  });

  it('filters by brand, period and rating, and sums up the brand and period whatever the rating', async () => {
    const { service, prisma } = harness();
    prisma.orderReview.count.mockResolvedValue(3);
    prisma.orderReview.groupBy.mockResolvedValue([
      { rating: 5, _count: { _all: 3 } },
      { rating: 4, _count: { _all: 1 } },
      { rating: 1, _count: { _all: 1 } },
    ]);

    const page = await service.list({
      brandId: 'brand-1',
      rating: 5,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-08T00:00:00.000Z',
      page: 2,
      pageSize: 10,
    });

    const scope = {
      brandId: 'brand-1',
      createdAt: { gte: at('2026-11-01T00:00:00.000Z'), lt: at('2026-11-08T00:00:00.000Z') },
    };
    expect(prisma.orderReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ...scope, rating: 5 }, skip: 10, take: 10 }),
    );
    expect(prisma.orderReview.count).toHaveBeenCalledWith({ where: { ...scope, rating: 5 } });
    expect(prisma.orderReview.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: scope }));
    expect(page).toMatchObject({
      total: 3,
      page: 2,
      pageSize: 10,
      count: 5,
      // (5×3 + 4 + 1) / 5 = 4
      averageRating: 4,
      ratingCounts: { '1': 1, '2': 0, '3': 0, '4': 1, '5': 3 },
    });
  });

  it('rounds the average to one decimal and has none without reviews', async () => {
    const { service, prisma } = harness();
    prisma.orderReview.groupBy.mockResolvedValueOnce([
      { rating: 5, _count: { _all: 2 } },
      { rating: 4, _count: { _all: 1 } },
    ]);
    expect((await service.list({})).averageRating).toBe(4.7);

    prisma.orderReview.groupBy.mockResolvedValueOnce([]);
    expect(await service.list({})).toMatchObject({
      count: 0,
      averageRating: null,
      ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    });
  });
});
