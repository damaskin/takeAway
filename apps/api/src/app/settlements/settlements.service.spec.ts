import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, type BrandPayout } from '@prisma/client';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { PrismaService } from '../prisma/prisma.service';
import { SettlementsService } from './settlements.service';

const NOW = new Date('2026-10-10T09:00:00Z');
const admin: AuthenticatedUser = { id: 'sa', role: Role.SUPER_ADMIN, email: null, phone: null, name: null };
const owner: AuthenticatedUser = { id: 'owner', role: Role.BRAND_ADMIN, email: null, phone: null, name: null };

function raw(overrides: Record<string, unknown>) {
  return {
    id: 'o',
    settledAt: new Date('2026-10-02T10:00:00Z'),
    subtotalCents: 0,
    discountCents: 0,
    pointsDiscountCents: 0,
    giftCardCents: 0,
    deliveryFeeCents: 0,
    totalCents: 0,
    capturedCents: 0n,
    refundedCents: 0n,
    hasCapture: false,
    ...overrides,
  };
}

/** Chișinău is UTC+3 until 25 October 2026, UTC+2 after. */
const ROWS = [
  // Settled before the period: part of the opening balance.
  raw({
    id: 'sept',
    settledAt: new Date('2026-09-28T09:00:00Z'),
    totalCents: 10000,
    capturedCents: 10000n,
    hasCapture: true,
  }),
  // 1 October, 23:30 in Chișinău — still the 1st there.
  raw({
    id: 'late',
    settledAt: new Date('2026-10-01T20:30:00Z'),
    totalCents: 2000,
    capturedCents: 2000n,
    hasCapture: true,
  }),
  // 2 October, 00:30 in Chișinău (21:30 UTC on the 1st).
  raw({
    id: 'midnight',
    settledAt: new Date('2026-10-01T21:30:00Z'),
    totalCents: 3000,
    capturedCents: 3000n,
    hasCapture: true,
  }),
  // A free coffee on a promo.
  raw({ id: 'free', settledAt: new Date('2026-10-03T08:00:00Z'), subtotalCents: 4000, discountCents: 4000 }),
];

function payout(overrides: Partial<BrandPayout> = {}): BrandPayout {
  return {
    id: 'p1',
    brandId: 'b1',
    currency: 'RUP',
    periodFrom: new Date('2026-09-28T00:00:00Z'),
    periodTo: new Date('2026-09-30T00:00:00Z'),
    timeZone: 'Europe/Chisinau',
    periodEnd: new Date('2026-09-30T21:00:00Z'),
    amountCents: 8500,
    cardNetCents: 10000,
    commissionCents: 1500,
    status: 'PAID',
    paidAt: new Date('2026-10-01T10:00:00Z'),
    reference: 'PP-1',
    comment: null,
    createdById: 'sa',
    paidById: 'sa',
    createdAt: new Date('2026-10-01T09:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

function setup(options: { payouts?: BrandPayout[]; rows?: unknown[]; scope?: string[] | null } = {}) {
  const payouts = options.payouts ?? [];
  const prisma = {
    brand: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'b1',
        name: 'NoName Coffee',
        plan: 'PRO',
        commissionBps: 1500,
        currency: 'RUP',
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    store: { findMany: jest.fn().mockResolvedValue([{ timezone: 'Europe/Chisinau' }]) },
    order: { findMany: jest.fn().mockResolvedValue([{ currency: 'MDL' }, { currency: 'RUP' }]) },
    brandCommissionRate: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ effectiveFrom: new Date('2026-09-01T00:00:00Z'), bps: 1500, source: 'PLAN' }]),
      findUnique: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
    },
    brandPayout: {
      findMany: jest
        .fn()
        .mockImplementation(async (args: { distinct?: unknown }) =>
          args.distinct ? [{ currency: 'RUP' }] : [...payouts].sort((a, b) => +b.periodEnd - +a.periodEnd),
        ),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
          payout({ id: 'p-new', status: 'PENDING', paidAt: null, ...data }),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest
      .fn()
      .mockImplementation(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('pg_advisory_xact_lock') ? [{ locked: 1 }] : (options.rows ?? ROWS),
      ),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const brandScope = {
    resolveBrandIds: jest.fn().mockResolvedValue(options.scope === undefined ? null : options.scope),
  };
  const svc = new SettlementsService(prisma as unknown as PrismaService, brandScope as unknown as BrandScopeService);
  return { svc, prisma, brandScope };
}

describe('SettlementsService.report', () => {
  it('needs a brand from a platform admin', async () => {
    const { svc } = setup();
    await expect(svc.report(admin, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a brand owner another brand's settlements", async () => {
    const { svc } = setup({ scope: ['b1'] });
    await expect(svc.report(owner, { brandId: 'b2' }, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives a brand owner their own brand by default', async () => {
    const { svc, prisma } = setup({ scope: ['b1'] });
    const report = await svc.report(owner, { from: '2026-10-01', to: '2026-10-07' }, NOW);
    expect(report.brand.id).toBe('b1');
    expect(prisma.brand.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' } }));
  });

  it("counts the brand's days in its own time zone, at the rate of the day", async () => {
    const { svc } = setup({ payouts: [payout()] });
    const report = await svc.report(admin, { brandId: 'b1', from: '2026-10-01', to: '2026-10-07' }, NOW);

    expect(report.period).toEqual({ from: '2026-10-01', to: '2026-10-07', days: 7, timeZone: 'Europe/Chisinau' });
    expect(report.currency).toBe('RUP');
    expect(report.currencies).toEqual(['RUP', 'MDL']);
    expect(report.days).toHaveLength(7);
    expect(report.days[0]).toMatchObject({ date: '2026-10-01', orders: 1, capturedCents: 2000, commissionCents: 300 });
    expect(report.days[1]).toMatchObject({ date: '2026-10-02', orders: 1, capturedCents: 3000, commissionCents: 450 });
    expect(report.days[2]).toMatchObject({
      date: '2026-10-03',
      orders: 1,
      zeroTotalOrders: 1,
      promoDiscountCents: 4000,
    });
    expect(report.totals).toMatchObject({
      orders: 3,
      cardOrders: 2,
      capturedCents: 5000,
      commissionBaseCents: 5000,
      commissionCents: 750,
      payableCents: 4250,
    });
    expect(report.rates).toEqual([{ bps: 1500, source: 'PLAN', from: '2026-10-01', to: '2026-10-07' }]);
  });

  it('carries the September balance and previews the next payout from the day after the last one', async () => {
    const { svc } = setup({ payouts: [payout()] });
    const report = await svc.report(admin, { brandId: 'b1', from: '2026-10-01', to: '2026-10-07' }, NOW);

    // September: 8 500 earned and paid out.
    expect(report.balance).toEqual({
      openingCents: 0,
      payableCents: 4250,
      paidCents: 0,
      pendingCents: 0,
      closingCents: 4250,
      closingPendingCents: 0,
    });
    expect(report.nextPayout).toEqual({
      periodFrom: '2026-10-01',
      periodTo: '2026-10-07',
      amountCents: 4250,
      cardNetCents: 5000,
      commissionCents: 750,
      blocked: null,
      lastSettledDay: '2026-09-30',
    });
    expect(report.payouts[0]).toMatchObject({
      id: 'p1',
      periodFrom: '2026-09-28',
      periodTo: '2026-09-30',
      status: 'PAID',
    });
  });
});

describe('SettlementsService.createPayout', () => {
  it('fixes the balance owed at the end of the period, starting at the first counted order', async () => {
    const { svc, prisma } = setup();
    const created = await svc.createPayout(
      admin,
      { brandId: 'b1', currency: 'RUP', to: '2026-10-07', reference: 'X' },
      NOW,
    );

    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock');
    expect(prisma.brandPayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        brandId: 'b1',
        currency: 'RUP',
        periodFrom: new Date('2026-09-28T00:00:00.000Z'),
        periodTo: new Date('2026-10-07T00:00:00.000Z'),
        timeZone: 'Europe/Chisinau',
        // Local midnight after 7 October.
        periodEnd: new Date('2026-10-07T21:00:00.000Z'),
        amountCents: 8500 + 4250,
        cardNetCents: 15000,
        commissionCents: 2250,
        reference: 'X',
        createdById: 'sa',
      }),
    });
    expect(created).toMatchObject({ id: 'p-new', status: 'PENDING', periodFrom: '2026-09-28', periodTo: '2026-10-07' });
  });

  it('refuses a period that has not ended yet', async () => {
    const { svc, prisma } = setup();
    await expect(
      svc.createPayout(admin, { brandId: 'b1', currency: 'RUP', to: '2026-10-10' }, NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYOUT_PERIOD_OPEN' }),
    });
    expect(prisma.brandPayout.create).not.toHaveBeenCalled();
  });

  it('refuses days an earlier payout already settles', async () => {
    const { svc } = setup({
      payouts: [payout({ periodTo: new Date('2026-10-07T00:00:00Z'), periodEnd: new Date('2026-10-07T21:00:00Z') })],
    });
    await expect(
      svc.createPayout(admin, { brandId: 'b1', currency: 'RUP', to: '2026-10-05' }, NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYOUT_OVERLAP' }),
    });
  });

  it('refuses when nothing is owed', async () => {
    const { svc } = setup({ rows: [] });
    const attempt = svc.createPayout(admin, { brandId: 'b1', currency: 'RUP', to: '2026-10-07' }, NOW);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAYOUT_NOTHING_DUE' }) });
  });

  it('refuses a day that does not exist', async () => {
    const { svc } = setup();
    await expect(
      svc.createPayout(admin, { brandId: 'b1', currency: 'RUP', to: '2026-02-30' }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SettlementsService.markPaid', () => {
  it('marks a pending payout paid, now by default', async () => {
    const { svc, prisma } = setup();
    prisma.brandPayout.findUnique.mockResolvedValue(payout({ status: 'PAID', paidAt: NOW }));
    const paid = await svc.markPaid(admin, 'p1', { reference: 'PP-77' }, NOW);
    expect(prisma.brandPayout.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'PENDING' },
      data: { status: 'PAID', paidAt: NOW, paidById: 'sa', reference: 'PP-77' },
    });
    expect(paid.status).toBe('PAID');
  });

  it('refuses to pay the same payout twice', async () => {
    const { svc, prisma } = setup();
    prisma.brandPayout.updateMany.mockResolvedValue({ count: 0 });
    prisma.brandPayout.findUnique.mockResolvedValue(payout());
    await expect(svc.markPaid(admin, 'p1', {}, NOW)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYOUT_ALREADY_PAID' }),
    });
  });

  it('is a 404 for an unknown payout', async () => {
    const { svc, prisma } = setup();
    prisma.brandPayout.updateMany.mockResolvedValue({ count: 0 });
    prisma.brandPayout.findUnique.mockResolvedValue(null);
    await expect(svc.markPaid(admin, 'nope', {}, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SettlementsService.deletePayout', () => {
  it('removes the latest pending payout', async () => {
    const { svc, prisma } = setup();
    prisma.brandPayout.findUnique.mockResolvedValue(payout({ status: 'PENDING' }));
    prisma.brandPayout.findFirst.mockResolvedValue({ id: 'p1' });
    await svc.deletePayout('p1');
    expect(prisma.brandPayout.deleteMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'PENDING' } });
  });

  it('keeps a paid payout', async () => {
    const { svc, prisma } = setup();
    prisma.brandPayout.findUnique.mockResolvedValue(payout({ status: 'PAID' }));
    await expect(svc.deletePayout('p1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYOUT_PAID' }),
    });
  });

  it('keeps a payout a later one follows', async () => {
    const { svc, prisma } = setup();
    prisma.brandPayout.findUnique.mockResolvedValue(payout({ status: 'PENDING' }));
    prisma.brandPayout.findFirst.mockResolvedValue({ id: 'p2' });
    await expect(svc.deletePayout('p1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYOUT_NOT_LATEST' }),
    });
    expect(prisma.brandPayout.deleteMany).not.toHaveBeenCalled();
  });
});

describe('SettlementsService.setRate', () => {
  it("starts a rate at the brand's local midnight and returns the history", async () => {
    const { svc, prisma } = setup();
    prisma.brandCommissionRate.findMany.mockResolvedValue([]);
    await svc.setRate(admin, { brandId: 'b1', bps: 1200, effectiveFrom: '2026-11-01', note: 'Agreement 7' }, NOW);
    expect(prisma.brandCommissionRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          bps: 1200,
          source: 'INDIVIDUAL',
          // Chișinău is back on UTC+2 by November.
          effectiveFrom: new Date('2026-10-31T22:00:00.000Z'),
          note: 'Agreement 7',
          createdById: 'sa',
        }),
      }),
    );
  });

  it("goes back to the plan's rate without bps", async () => {
    const { svc, prisma } = setup();
    prisma.brandCommissionRate.findMany.mockResolvedValue([
      {
        id: 'r1',
        bps: 1500,
        source: 'PLAN',
        effectiveFrom: new Date('2026-09-01T00:00:00Z'),
        note: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);
    const history = await svc.setRate(admin, { brandId: 'b1', bps: null, effectiveFrom: '2026-12-01' }, NOW);
    expect(history).toMatchObject({ plan: 'PRO', planBps: 1500, timeZone: 'Europe/Chisinau' });
    expect(history.rates[0]).toMatchObject({ id: 'r1', effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveTo: null });
    expect(prisma.brandCommissionRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ bps: 1500, source: 'PLAN' }) }),
    );
  });
});

describe('SettlementsService.syncCurrentRates', () => {
  it('moves a brand onto a rate whose day has come', async () => {
    const { svc, prisma } = setup();
    prisma.brandCommissionRate.findMany.mockResolvedValue([
      { brandId: 'b1', effectiveFrom: new Date('2026-09-01T00:00:00Z'), bps: 1500 },
      { brandId: 'b1', effectiveFrom: new Date('2026-10-10T00:00:00Z'), bps: 1200 },
      { brandId: 'b2', effectiveFrom: new Date('2026-09-01T00:00:00Z'), bps: 1000 },
    ]);
    prisma.brand.findMany.mockResolvedValue([
      { id: 'b1', commissionBps: 1500 },
      { id: 'b2', commissionBps: 1000 },
    ]);
    await expect(svc.syncCurrentRates(NOW)).resolves.toBe(1);
    expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { commissionBps: 1200 } });
  });
});
