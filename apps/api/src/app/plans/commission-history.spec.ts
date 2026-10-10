import type { Prisma } from '@prisma/client';

import { rateAt, rateSourceFor, recordCommissionRate, syncCurrentCommission } from './commission-history';

const at = (iso: string) => new Date(iso);

describe('rateAt', () => {
  const timeline = [
    { effectiveFrom: at('2026-10-01T00:00:00Z'), bps: 1500 },
    { effectiveFrom: at('2026-11-01T00:00:00Z'), bps: 1200 },
    { effectiveFrom: at('2026-12-01T00:00:00Z'), bps: 1500 },
  ];

  it('takes the latest rate that started at or before the instant', () => {
    expect(rateAt(timeline, at('2026-10-15T12:00:00Z'), 999)).toBe(1500);
    expect(rateAt(timeline, at('2026-11-20T12:00:00Z'), 999)).toBe(1200);
    expect(rateAt(timeline, at('2027-01-01T00:00:00Z'), 999)).toBe(1500);
  });

  it('starts a rate exactly at its instant, and the old one ends there', () => {
    expect(rateAt(timeline, at('2026-11-01T00:00:00Z'), 999)).toBe(1200);
    expect(rateAt(timeline, at('2026-10-31T23:59:59.999Z'), 999)).toBe(1500);
  });

  it('extends the first rate back over anything before it', () => {
    expect(rateAt(timeline, at('2026-01-01T00:00:00Z'), 999)).toBe(1500);
  });

  it("uses the brand's current rate when there is no history", () => {
    expect(rateAt([], at('2026-10-15T00:00:00Z'), 1000)).toBe(1000);
  });
});

describe('rateSourceFor', () => {
  it("is PLAN at the plan's default and INDIVIDUAL otherwise", () => {
    expect(rateSourceFor('PRO', 1500)).toBe('PLAN');
    expect(rateSourceFor('BASIC', 1000)).toBe('PLAN');
    expect(rateSourceFor('BASIC', 1500)).toBe('INDIVIDUAL');
    expect(rateSourceFor('PRO', 1200)).toBe('INDIVIDUAL');
  });
});

function fakeTx(options: { recorded: number; timeline: Array<{ effectiveFrom: Date; bps: number }> }) {
  const tx = {
    brand: {
      findUnique: jest.fn().mockResolvedValue({
        commissionBps: 1000,
        plan: 'BASIC',
        createdAt: at('2026-09-01T08:00:00Z'),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    brandCommissionRate: {
      count: jest.fn().mockResolvedValue(options.recorded),
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'r-new',
        ...create,
      })),
      findMany: jest.fn().mockResolvedValue(options.timeline),
    },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

describe('recordCommissionRate', () => {
  const now = at('2026-10-10T12:00:00Z');

  it('writes the rate the brand has had so far before the first change, so the past keeps it', async () => {
    const { tx, client } = fakeTx({
      recorded: 0,
      timeline: [
        { effectiveFrom: at('2026-09-01T08:00:00Z'), bps: 1000 },
        { effectiveFrom: now, bps: 1500 },
      ],
    });

    await recordCommissionRate(client, { brandId: 'b1', bps: 1500, source: 'PLAN', effectiveFrom: now }, now);

    expect(tx.brandCommissionRate.create).toHaveBeenCalledWith({
      data: { brandId: 'b1', bps: 1000, source: 'PLAN', effectiveFrom: at('2026-09-01T08:00:00Z') },
    });
    expect(tx.brandCommissionRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { brandId_effectiveFrom: { brandId: 'b1', effectiveFrom: now } },
        create: expect.objectContaining({ bps: 1500, source: 'PLAN' }),
      }),
    );
    expect(tx.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { commissionBps: 1500 } });
  });

  it('adds no baseline once the brand has a history', async () => {
    const { tx, client } = fakeTx({
      recorded: 2,
      timeline: [{ effectiveFrom: at('2026-09-01T08:00:00Z'), bps: 1000 }],
    });
    await recordCommissionRate(
      client,
      { brandId: 'b1', bps: 1200, source: 'INDIVIDUAL', effectiveFrom: at('2026-11-01T00:00:00Z') },
      now,
    );
    expect(tx.brandCommissionRate.create).not.toHaveBeenCalled();
  });

  it('adds no baseline when the new rate reaches back to the creation of the brand', async () => {
    const { tx, client } = fakeTx({
      recorded: 0,
      timeline: [{ effectiveFrom: at('2026-08-01T00:00:00Z'), bps: 1200 }],
    });
    await recordCommissionRate(
      client,
      { brandId: 'b1', bps: 1200, source: 'INDIVIDUAL', effectiveFrom: at('2026-08-01T00:00:00Z') },
      now,
    );
    expect(tx.brandCommissionRate.create).not.toHaveBeenCalled();
    expect(tx.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { commissionBps: 1200 } });
  });

  it('keeps the current rate on the brand while a future rate waits for its day', async () => {
    const { tx, client } = fakeTx({
      recorded: 1,
      timeline: [
        { effectiveFrom: at('2026-09-01T08:00:00Z'), bps: 1000 },
        { effectiveFrom: at('2026-11-01T00:00:00Z'), bps: 800 },
      ],
    });
    await recordCommissionRate(
      client,
      { brandId: 'b1', bps: 800, source: 'INDIVIDUAL', effectiveFrom: at('2026-11-01T00:00:00Z') },
      now,
    );
    expect(tx.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { commissionBps: 1000 } });
  });
});

describe('syncCurrentCommission', () => {
  it('leaves a brand without history alone', async () => {
    const { tx, client } = fakeTx({ recorded: 0, timeline: [] });
    await expect(syncCurrentCommission(client, 'b1')).resolves.toBeNull();
    expect(tx.brand.update).not.toHaveBeenCalled();
  });
});
