import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { PrismaService } from '../prisma/prisma.service';
import { TakeawayPromoAdminService } from '../takeaway-promos/takeaway-promo-admin.service';
import { redemptionRow } from '../takeaway-promos/testing/redemption-rows';
import { SettlementsService } from './settlements.service';

const NOW = new Date('2026-11-20T09:00:00Z');
const admin: AuthenticatedUser = { id: 'sa', role: Role.SUPER_ADMIN, email: null, phone: null, name: null };
const owner: AuthenticatedUser = { id: 'owner', role: Role.BRAND_ADMIN, email: null, phone: null, name: null };

const paid = { id: 'payout-1', status: 'CONFIRMED' as const, confirmedAt: new Date('2026-11-12T10:00:00Z') };
const pending = { id: 'payout-2', status: 'PENDING' as const, confirmedAt: null };

/** brand-1's promo orders in RUP, Chișinău time (UTC+2 in November). */
const ROWS = [
  // Before the period: in the debt, not in the period's figures.
  redemptionRow({ id: 'r-old', orderCode: '0001', acceptedAt: new Date('2026-11-01T10:00:00Z'), payout: paid }),
  // 10 November, 00:30 in Chișinău (22:30 UTC on the 9th) — inside the period.
  redemptionRow({
    id: 'r-midnight',
    orderCode: '0002',
    acceptedAt: new Date('2026-11-09T22:30:00Z'),
    payout: paid,
  }),
  // Paid by card, not accepted yet; in a fixed payout.
  redemptionRow({
    id: 'r-card',
    orderCode: '0003',
    storeName: 'Вокзал',
    acceptedAt: null,
    capturedAt: [new Date('2026-11-15T08:00:00Z')],
    menuTotalCents: 1_555,
    discountCents: 156,
    payout: pending,
  }),
  // Owed, in no payout yet.
  redemptionRow({ id: 'r-new', orderCode: '0004', acceptedAt: new Date('2026-11-18T12:00:00Z') }),
  // Waiting for its payment: holds budget, owes nothing yet.
  redemptionRow({ id: 'r-unpaid', orderCode: '0005', acceptedAt: null, orderStatus: 'CREATED' }),
]
  .map((r) => ({ ...r, currency: 'RUP' as const, order: { ...r.order, currency: 'RUP' as const } }))
  .map((r) => ({ ...r, order: { ...r.order, payments: r.order.payments.map((p) => ({ ...p, currency: 'RUP' })) } }));

function setup(scope: string[] | null = null) {
  const prisma = {
    brand: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'brand-1', name: 'NoName Coffee', plan: 'PRO', commissionBps: 1500, currency: 'RUP' }),
    },
    store: { findMany: jest.fn().mockResolvedValue([{ timezone: 'Europe/Chisinau' }]) },
    takeawayPromoRedemption: { findMany: jest.fn().mockResolvedValue(ROWS) },
  };
  const brandScope = { resolveBrandIds: jest.fn().mockResolvedValue(scope) };
  const settlements = new SettlementsService(
    prisma as unknown as PrismaService,
    brandScope as unknown as BrandScopeService,
  );
  const platform = new TakeawayPromoAdminService(prisma as unknown as PrismaService);
  return { settlements, platform, prisma };
}

describe('SettlementsService.takeawayPromos — the brand cabinet (docs/takeaway-promos.md §4.2)', () => {
  it('sums the orders that counted in the period, local days of the brand, newest first', async () => {
    const { settlements, prisma } = setup();

    const report = await settlements.takeawayPromos(
      admin,
      { brandId: 'brand-1', from: '2026-11-10', to: '2026-11-19' },
      NOW,
    );

    expect(prisma.takeawayPromoRedemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ brandId: 'brand-1', currency: 'RUP' }, { order: { status: { notIn: ['CANCELLED', 'EXPIRED'] } } }],
        },
      }),
    );
    expect(report).toMatchObject({
      brandId: 'brand-1',
      currency: 'RUP',
      period: { from: '2026-11-10', to: '2026-11-19', timeZone: 'Europe/Chisinau' },
      orders: 3,
      menuTotalCents: 21_555,
      paidByGuestCents: 21_555 - 2_156,
      compensationAccruedCents: 2_156,
      compensationRepaidCents: 1_000,
      // All time: 3 156 accrued − 2 000 repaid.
      currentDebtCents: 1_156,
    });
    expect(report.items.map((i) => [i.orderCode, i.status, i.repaidAt])).toEqual([
      ['0004', 'ACCRUED', null],
      ['0003', 'IN_PAYOUT', null],
      ['0002', 'REPAID', '2026-11-12T10:00:00.000Z'],
    ]);
    expect(report.items[1]).toMatchObject({
      storeName: 'Вокзал',
      settledAt: '2026-11-15T08:00:00.000Z',
      menuTotalCents: 1_555,
      paidByGuestCents: 1_399,
      compensationCents: 156,
      payoutId: 'payout-2',
    });
  });

  it('shows the same current debt as the brand’s row of the platform debt report', async () => {
    const { settlements, platform } = setup();

    const cabinet = await settlements.takeawayPromos(admin, { brandId: 'brand-1', days: 7 }, NOW);
    const debt = await platform.debt();

    const row = debt.rows.find((r) => r.brandId === 'brand-1' && r.currency === 'RUP');
    expect(row?.debtCents).toBe(cabinet.currentDebtCents);
    expect(row).toMatchObject({ accruedCents: 3_156, inPayoutCents: 156, repaidCents: 2_000, debtCents: 1_156 });
  });

  it('keeps a brand owner to their own brand', async () => {
    const { settlements } = setup(['brand-2']);
    await expect(settlements.takeawayPromos(owner, { brandId: 'brand-1' }, NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
