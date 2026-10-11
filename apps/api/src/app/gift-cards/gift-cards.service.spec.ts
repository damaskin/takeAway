import { HttpException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { GiftCardsService } from './gift-cards.service';

interface Card {
  id: string;
  code: string;
  brandId: string;
  currency: string;
  status: 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  balanceCents: number;
  expiresAt: Date | null;
}

/**
 * One gift card in memory. Each call yields to the event loop first, so two
 * checkouts running "at the same time" interleave the way two Postgres
 * transactions do; the conditional update itself is applied in one step,
 * as Postgres applies an UPDATE … WHERE under the row lock.
 */
function store(balanceCents: number) {
  const card: Card = {
    id: 'gc-1',
    code: 'GIFT2026ABCD',
    brandId: 'brand-a',
    currency: 'MDL',
    status: 'ACTIVE',
    balanceCents,
    expiresAt: null,
  };
  const redemptions: Array<{ orderId: string; amountCents: number }> = [];
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  const tx = {
    giftCard: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status: string; balanceCents: { gte: number } };
          data: { balanceCents: { decrement: number } };
        }) => {
          await tick();
          const matches =
            card.id === where.id && card.status === where.status && card.balanceCents >= where.balanceCents.gte;
          if (!matches) return { count: 0 };
          card.balanceCents -= data.balanceCents.decrement;
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async () => {
        await tick();
        return { balanceCents: card.balanceCents };
      }),
      update: jest.fn(async ({ data }: { data: Partial<Card> }) => Object.assign(card, data)),
    },
    giftCardRedemption: {
      create: jest.fn(async ({ data }: { data: { orderId: string; amountCents: number } }) => {
        await tick();
        redemptions.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    giftCard: {
      findUnique: jest.fn(async () => {
        await tick();
        return { ...card };
      }),
    },
  };
  const service = new GiftCardsService(prisma as unknown as PrismaService);
  return { service, card, redemptions, tx: tx as unknown as Prisma.TransactionClient, raw: tx };
}

describe('GiftCardsService redemption', () => {
  const checkout = { code: 'gift-2026-abcd', brandId: 'brand-a', subtotalCents: 1000, currency: 'MDL' as const };

  it('lets exactly one of two simultaneous checkouts spend the same balance', async () => {
    const { service, card, redemptions, tx } = store(1000);

    // Both checkouts validate before either has written anything: both see 10.00.
    const [first, second] = await Promise.all([service.validateForOrder(checkout), service.validateForOrder(checkout)]);
    expect(first.amountCents).toBe(1000);
    expect(second.amountCents).toBe(1000);

    const results = await Promise.allSettled([
      service.applyRedemption(tx, { giftCardId: card.id, orderId: 'order-1', amountCents: first.amountCents }),
      service.applyRedemption(tx, { giftCardId: card.id, orderId: 'order-2', amountCents: second.amountCents }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(lost?.reason).toBeInstanceOf(HttpException);
    expect((lost?.reason as HttpException).getStatus()).toBe(409);
    expect((lost?.reason as HttpException).getResponse()).toMatchObject({ code: 'GIFT_CARD_BALANCE_CHANGED' });

    // The money was spent once: never below zero, one redemption, card drained.
    expect(card.balanceCents).toBe(0);
    expect(card.status).toBe('REDEEMED');
    expect(redemptions).toHaveLength(1);
  });

  it('debits with a guard on status and balance, not a blind decrement', async () => {
    const { service, card, tx, raw } = store(1500);

    await service.applyRedemption(tx, { giftCardId: card.id, orderId: 'order-1', amountCents: 600 });

    expect(raw.giftCard.updateMany).toHaveBeenCalledWith({
      where: { id: 'gc-1', status: 'ACTIVE', balanceCents: { gte: 600 } },
      data: { balanceCents: { decrement: 600 } },
    });
    expect(card.balanceCents).toBe(900);
    expect(card.status).toBe('ACTIVE');
  });

  it('refuses a card the admin cancelled between validation and payment', async () => {
    const { service, card, redemptions, tx } = store(1000);
    const validated = await service.validateForOrder(checkout);
    card.status = 'CANCELLED';
    card.balanceCents = 0;

    await expect(
      service.applyRedemption(tx, { giftCardId: card.id, orderId: 'order-1', amountCents: validated.amountCents }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(redemptions).toHaveLength(0);
  });
});
