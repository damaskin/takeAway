import { PrismaClient, Role } from '@prisma/client';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { PrismaService } from '../prisma/prisma.service';
import { SettlementsService } from './settlements.service';

/**
 * Netted settlements on a real Postgres (docs/settlements.md): the order
 * query, takeAway's points compensation (gone once an order is cancelled),
 * and one settlement through «зафиксировать → оплачено → получено». Opt-in:
 * set SETTLEMENTS_IT_DATABASE_URL to a throwaway database with the migrations
 * applied (`prisma migrate deploy`). The suite adds rows with ids starting
 * `stit-` and deletes them again. Never point it at a database you care
 * about.
 */
const url = process.env['SETTLEMENTS_IT_DATABASE_URL'];
const suite = url ? describe : describe.skip;

const BRAND = 'stit-brand';
const STORE = 'stit-store';
const CUSTOMER = 'stit-user';
const NOW = new Date('2026-11-14T09:00:00Z');
const admin: AuthenticatedUser = { id: 'stit-sa', role: Role.SUPER_ADMIN, email: null, phone: null, name: null };
const owner: AuthenticatedUser = { id: 'stit-owner', role: Role.BRAND_ADMIN, email: null, phone: null, name: null };

suite('settlements on Postgres', () => {
  let prisma: PrismaClient;
  let scope: string[] | null = null;
  let svc: SettlementsService;
  let n = 0;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await cleanUp(prisma);
    await prisma.brand.create({
      data: { id: BRAND, slug: BRAND, name: 'STIT Coffee', currency: 'RUP', plan: 'PRO', commissionBps: 1500 },
    });
    await prisma.store.create({
      data: {
        id: STORE,
        brandId: BRAND,
        slug: STORE,
        name: 'Центр',
        addressLine: 'Юности 12',
        city: 'Тирасполь',
        country: 'MD',
        latitude: 46.84,
        longitude: 29.66,
        currency: 'RUP',
        timezone: 'UTC',
      },
    });
    await prisma.user.create({ data: { id: CUSTOMER, name: CUSTOMER } });
    const brandScope = { resolveBrandIds: jest.fn(async () => scope) };
    svc = new SettlementsService(prisma as unknown as PrismaService, brandScope as unknown as BrandScopeService);
  });

  afterAll(async () => {
    await cleanUp(prisma);
    await prisma.$disconnect();
  });

  /** An accepted order of 12 November paid by card, as the money arrived. */
  async function order(input: {
    subtotalCents: number;
    pointsDiscountCents?: number;
    capturedCents: number;
    refundedCents?: number;
    status?: 'PICKED_UP' | 'CANCELLED';
  }) {
    n += 1;
    const points = input.pointsDiscountCents ?? 0;
    const refunded = input.refundedCents ?? 0;
    await prisma.order.create({
      data: {
        id: `stit-order-${n}`,
        userId: CUSTOMER,
        storeId: STORE,
        status: input.status ?? 'PICKED_UP',
        pickupMode: 'ASAP',
        pickupAt: new Date('2026-11-12T10:15:00Z'),
        acceptedAt: new Date('2026-11-12T10:00:00Z'),
        subtotalCents: input.subtotalCents,
        discountCents: points,
        pointsDiscountCents: points,
        pointsSpent: points,
        totalCents: input.subtotalCents - points,
        currency: 'RUP',
        orderCode: `stit-${n}`,
        qrToken: `stit-${n}`,
        createdAt: new Date('2026-11-12T09:59:00Z'),
        payments: {
          create: {
            provider: 'AGROPROMBANK',
            status: refunded >= input.capturedCents ? 'REFUNDED' : 'SUCCEEDED',
            amountCents: input.capturedCents,
            refundedCents: refunded,
            currency: 'RUP',
            createdAt: new Date('2026-11-12T09:59:30Z'),
          },
        },
      },
    });
  }

  it('nets commission against the points compensation and settles it both sides', async () => {
    // 100 by card: 15 of commission.
    await order({ subtotalCents: 10_000, capturedCents: 10_000 });
    // 50, of which 30 in points: 7.50 of commission on the full 50, 30 owed by takeAway.
    await order({ subtotalCents: 5_000, pointsDiscountCents: 3_000, capturedCents: 2_000 });
    // Cancelled and refunded: the points went back, nothing either way.
    await order({
      subtotalCents: 4_000,
      pointsDiscountCents: 1_000,
      capturedCents: 3_000,
      refundedCents: 3_000,
      status: 'CANCELLED',
    });

    const report = await svc.report(admin, { brandId: BRAND, from: '2026-11-12', to: '2026-11-13' }, NOW);
    expect(report.totals).toMatchObject({
      orders: 3,
      cardNetCents: 12_000,
      pointsDiscountCents: 4_000,
      pointsCompensationCents: 3_000,
      takeawayCompensationCents: 0,
      compensationCents: 3_000,
      commissionBaseCents: 15_000,
      commissionCents: 2_250,
      netCents: -750,
    });
    expect(report.nextPayout).toMatchObject({
      periodFrom: '2026-11-12',
      periodTo: '2026-11-13',
      direction: 'TAKEAWAY_TO_BRAND',
      amountCents: 750,
      blocked: null,
    });

    const fixed = await svc.createPayout(admin, { brandId: BRAND, currency: 'RUP', to: '2026-11-13' }, NOW);
    expect(fixed).toMatchObject({
      direction: 'TAKEAWAY_TO_BRAND',
      amountCents: 750,
      pointsCompensationCents: 3_000,
      status: 'PENDING',
    });

    // takeAway pays; the brand cannot mark takeAway's payment.
    scope = [BRAND];
    await expect(svc.markPaid(owner, fixed.id, {}, NOW)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYOUT_NOT_YOUR_SIDE' }),
    });
    scope = null;
    await svc.markPaid(admin, fixed.id, { reference: 'ПП 12' }, NOW);

    // Not confirmed yet: still owed.
    let after = await svc.report(admin, { brandId: BRAND, from: '2026-11-12', to: '2026-11-13' }, NOW);
    expect(after.balance).toMatchObject({ closingCents: -750, closingOpenCents: -750 });

    scope = [BRAND];
    const confirmed = await svc.confirm(owner, fixed.id, { received: true }, NOW);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', reference: 'ПП 12' });

    scope = null;
    after = await svc.report(admin, { brandId: BRAND, from: '2026-11-12', to: '2026-11-13' }, NOW);
    expect(after.balance).toMatchObject({ settledCents: -750, closingCents: 0, closingOpenCents: 0 });
    expect(after.nextPayout).toMatchObject({ blocked: 'OVERLAP', lastSettledDay: '2026-11-13' });
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  await prisma.brandPayout.deleteMany({ where: { brandId: BRAND } });
  await prisma.order.deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.user.deleteMany({ where: { id: CUSTOMER } });
  await prisma.brandCommissionRate.deleteMany({ where: { brandId: BRAND } });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
