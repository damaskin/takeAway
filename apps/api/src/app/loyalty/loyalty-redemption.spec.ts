import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyService, ledgerPoints } from './loyalty.service';

function makeService(balance: number): { service: LoyaltyService; prisma: { loyaltyAccount: { upsert: jest.Mock } } } {
  const prisma = {
    loyaltyAccount: {
      upsert: jest.fn().mockResolvedValue({
        id: 'acc-1',
        userId: 'user-1',
        pointsBalance: balance,
        lifetimePoints: balance,
        tier: 'SILVER',
      }),
    },
  };
  return { service: new LoyaltyService(prisma as unknown as PrismaService), prisma };
}

describe('LoyaltyService.quoteRedemption', () => {
  // Every figure is in units, a hundredth of a point: 500 units are 5 points,
  // worth 5.00 — 1 балл = 1 руб.
  it('values a unit at one cent, so a point is one currency unit', async () => {
    const { service } = makeService(1000);
    await expect(service.quoteRedemption('user-1', 500, 10_000)).resolves.toEqual({
      points: 500,
      discountCents: 500,
    });
  });

  it('clamps to the balance the customer actually has', async () => {
    const { service } = makeService(300);
    await expect(service.quoteRedemption('user-1', 10_000, 100_000)).resolves.toEqual({
      points: 300,
      discountCents: 300,
    });
  });

  it('clamps to the order value, so points never become a cash refund', async () => {
    const { service } = makeService(50_000);
    // A 12.00 order can absorb 1200 points and no more.
    await expect(service.quoteRedemption('user-1', 50_000, 1_200)).resolves.toEqual({
      points: 1_200,
      discountCents: 1_200,
    });
  });

  it('refuses a redemption below the floor', async () => {
    const { service } = makeService(5_000);
    await expect(service.quoteRedemption('user-1', 99, 10_000)).resolves.toEqual({
      points: 0,
      discountCents: 0,
    });
  });

  it('refuses when the balance is below the floor, however much is asked', async () => {
    const { service } = makeService(40);
    await expect(service.quoteRedemption('user-1', 40, 10_000)).resolves.toEqual({
      points: 0,
      discountCents: 0,
    });
  });

  it('refuses when the order is too small to absorb the floor', async () => {
    const { service } = makeService(5_000);
    // A 0.50 order cannot take 100 points' worth without going negative.
    await expect(service.quoteRedemption('user-1', 5_000, 50)).resolves.toEqual({
      points: 0,
      discountCents: 0,
    });
  });

  it('takes nothing on a zero-value order', async () => {
    const { service } = makeService(5_000);
    await expect(service.quoteRedemption('user-1', 1_000, 0)).resolves.toEqual({
      points: 0,
      discountCents: 0,
    });
  });

  it('ignores junk without reaching the database', async () => {
    const { service, prisma } = makeService(5_000);
    await expect(service.quoteRedemption('user-1', Number.NaN, 10_000)).resolves.toEqual({
      points: 0,
      discountCents: 0,
    });
    await expect(service.quoteRedemption('user-1', -500, 10_000)).resolves.toEqual({
      points: 0,
      discountCents: 0,
    });
    expect(prisma.loyaltyAccount.upsert).not.toHaveBeenCalled();
  });

  it('rounds a fractional ask down rather than up', async () => {
    const { service } = makeService(5_000);
    await expect(service.quoteRedemption('user-1', 250.9, 10_000)).resolves.toEqual({
      points: 250,
      discountCents: 250,
    });
  });
});

describe('LoyaltyService.releaseForOrder', () => {
  function harness(spend: Record<string, unknown> | null) {
    const account = {
      id: 'acc-1',
      userId: 'user-1',
      pointsBalance: 100,
      lifetimePoints: 4_000,
      tier: 'PLATINUM',
    };
    const tx = {
      pointsLedger: {
        findFirst: jest.fn().mockResolvedValue(spend),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      loyaltyAccount: { upsert: jest.fn().mockResolvedValue(account), update: jest.fn() },
    };
    const service = new LoyaltyService({} as unknown as PrismaService);
    return { service, tx, account };
  }

  it('puts the spent points back on the balance', async () => {
    const { service, tx } = harness({ id: 'led-1', userId: 'user-1', amount: -250, type: 'SPEND' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.releaseForOrder(tx as any, 'order-1');

    expect(tx.loyaltyAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pointsBalance: 350 }) }),
    );
  });

  it('does not let a refund advance the tier', async () => {
    const { service, tx } = harness({ id: 'led-1', userId: 'user-1', amount: -250, type: 'SPEND' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.releaseForOrder(tx as any, 'order-1');

    // Lifetime is untouched: giving back points a cancelled order took is
    // undoing a spend, not earning. Otherwise a customer could promote
    // themselves by ordering and cancelling in a loop.
    expect(tx.loyaltyAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lifetimePoints: 4_000 }) }),
    );
  });

  it('writes the refund in points in the ledger', async () => {
    const { service, tx } = harness({ id: 'led-1', userId: 'user-1', amount: -250, type: 'SPEND' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.releaseForOrder(tx as any, 'order-1');

    expect(tx.pointsLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 250, reason: 'Refunded 2.50 points from order order-1' }),
      }),
    );
  });

  it('does nothing for an order that never spent points', async () => {
    const { service, tx } = harness(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.releaseForOrder(tx as any, 'order-1');

    expect(tx.loyaltyAccount.update).not.toHaveBeenCalled();
    expect(tx.pointsLedger.create).not.toHaveBeenCalled();
  });
});

describe('LoyaltyService.creditForOrder', () => {
  it('earns a unit per 100 cents — 0.40 points on a 40.00 order — and says so in points', async () => {
    const account = { id: 'acc-1', userId: 'user-1', pointsBalance: 0, lifetimePoints: 0, tier: 'SILVER' };
    const tx = {
      pointsLedger: { create: jest.fn() },
      loyaltyAccount: { upsert: jest.fn().mockResolvedValue(account), update: jest.fn() },
    };
    const service = new LoyaltyService({} as unknown as PrismaService);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.creditForOrder('user-1', 'order-1', 4_000, 1, tx as any);

    expect(tx.loyaltyAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pointsBalance: 40, lifetimePoints: 40 }) }),
    );
    expect(tx.pointsLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 40, reason: 'Order order-1 · +0.40 points' }),
      }),
    );
  });
});

describe('ledgerPoints', () => {
  it('writes units as points, whole ones without decimals', () => {
    expect(ledgerPoints(100)).toBe('1 point');
    expect(ledgerPoints(500)).toBe('5 points');
    expect(ledgerPoints(40)).toBe('0.40 points');
    expect(ledgerPoints(245_050)).toBe('2,450.50 points');
  });
});
