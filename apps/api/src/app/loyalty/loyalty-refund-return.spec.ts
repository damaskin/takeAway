import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyService } from './loyalty.service';

type Payment = { amountCents: number; refundedCents: number; currency: string };

/**
 * A card refund gives the guest back the same share of the points spent on
 * the order: takeAway stops compensating that share to the brand (owner,
 * 2026-11-17). An in-memory stand-in for the two tables involved.
 */
function setup(order: { pointsSpent: number; status?: string; payments: Payment[] }, alreadyReturned: number[] = []) {
  const ledger: Array<{ amount: number; metadata: unknown }> = alreadyReturned.map((amount) => ({
    amount,
    metadata: { kind: 'refund-return' },
  }));
  const account = { id: 'acc-1', userId: 'user-1', pointsBalance: 0, lifetimePoints: 500, tier: 'SILVER' };
  const tx = {
    order: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'user-1',
        status: order.status ?? 'PICKED_UP',
        currency: 'RUP',
        pointsSpent: order.pointsSpent,
        payments: order.payments,
      }),
    },
    pointsLedger: {
      findMany: jest.fn().mockImplementation(async () => ledger.map((l) => ({ amount: l.amount }))),
      create: jest.fn().mockImplementation(async ({ data }) => {
        ledger.push({ amount: data.amount, metadata: data.metadata });
        return data;
      }),
    },
    loyaltyAccount: {
      upsert: jest.fn().mockResolvedValue(account),
      update: jest.fn().mockImplementation(async ({ data }) => Object.assign(account, data)),
    },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { service: new LoyaltyService(prisma as unknown as PrismaService), tx, ledger, account };
}

const card = (amountCents: number, refundedCents: number, currency = 'RUP'): Payment => ({
  amountCents,
  refundedCents,
  currency,
});

describe('LoyaltyService.returnForRefund', () => {
  it('gives back the refunded share of the points, without advancing the tier', async () => {
    // 20.00 in points, 70.00 by card, 35.00 refunded: 10.00 back.
    const { service, account } = setup({ pointsSpent: 2000, payments: [card(7000, 3500)] });
    await expect(service.returnForRefund('o1')).resolves.toBe(1000);
    expect(account.pointsBalance).toBe(1000);
    expect(account.lifetimePoints).toBe(500);
  });

  it('counts across partial refunds and never returns more than was spent', async () => {
    const { service } = setup({ pointsSpent: 2000, payments: [card(7000, 7000)] }, [1000]);
    await expect(service.returnForRefund('o1')).resolves.toBe(1000);
  });

  it('does nothing twice for the same refund', async () => {
    const { service } = setup({ pointsSpent: 2000, payments: [card(7000, 3500)] }, [1000]);
    await expect(service.returnForRefund('o1')).resolves.toBe(0);
  });

  it('does nothing without points, without a refund, or for a cancelled order', async () => {
    await expect(setup({ pointsSpent: 0, payments: [card(7000, 7000)] }).service.returnForRefund('o1')).resolves.toBe(
      0,
    );
    await expect(setup({ pointsSpent: 2000, payments: [card(7000, 0)] }).service.returnForRefund('o1')).resolves.toBe(
      0,
    );
    await expect(
      setup({ pointsSpent: 2000, status: 'CANCELLED', payments: [card(7000, 7000)] }).service.returnForRefund('o1'),
    ).resolves.toBe(0);
  });

  it('rounds half up', async () => {
    // 3 points × 1/2 = 1.5 → 2.
    const { service } = setup({ pointsSpent: 3, payments: [card(2, 1)] });
    await expect(service.returnForRefund('o1')).resolves.toBe(2);
  });
});

describe('LoyaltyService.releaseForOrder after a partial refund', () => {
  it('gives back only what the refund has not given back already', async () => {
    const { service, tx, account } = setup({ pointsSpent: 2000, payments: [] }, [1000]);
    const withSpend = {
      ...tx,
      pointsLedger: {
        ...tx.pointsLedger,
        findFirst: jest.fn().mockResolvedValue({ userId: 'user-1', amount: -2000 }),
      },
    };
    await service.releaseForOrder(withSpend as never, 'o1');
    expect(account.pointsBalance).toBe(1000);
  });
});
