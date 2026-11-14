import type { TakeawayPromo } from '@prisma/client';
import type { CreateTakeawayPromoInput } from '@takeaway/shared-types';

import type { PrismaService } from '../prisma/prisma.service';
import { TakeawayPromoAdminService } from './takeaway-promo-admin.service';
import { redemptionRow } from './testing/redemption-rows';

const NOW = new Date('2026-11-10T12:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60_000);

type Row = TakeawayPromo & { _count: { redemptions: number } };

const promoRow = (over: Partial<TakeawayPromo> = {}, redemptions = 0): Row => ({
  id: 'tp-1',
  name: 'Осенняя акция',
  code: 'AUTUMN10',
  percent: 10,
  startsAt: day(-1),
  endsAt: day(30),
  currency: 'MDL',
  budgetCents: 100_000,
  spentCents: 0,
  status: 'ACTIVE',
  exhaustedAt: null,
  isWelcome: false,
  createdById: 'admin-1',
  createdAt: day(-2),
  updatedAt: day(-2),
  ...over,
  _count: { redemptions },
});

const input = (over: Partial<CreateTakeawayPromoInput> = {}): CreateTakeawayPromoInput => ({
  name: '  Осенняя акция ',
  code: 'autumn10',
  percent: 10,
  startsAt: day(0).toISOString(),
  endsAt: day(30).toISOString(),
  currency: 'MDL',
  budgetCents: 100_000,
  ...over,
});

function harness(current: Row | null = promoRow()) {
  let row = current;
  const prisma = {
    takeawayPromo: {
      findMany: jest.fn(async () => (row ? [row] : [])),
      findUnique: jest.fn(async ({ where }: { where: { id?: string; code?: string } }) =>
        where.id && row?.id === where.id ? row : null,
      ),
      // Another live welcome promo, when a test sets one.
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Partial<TakeawayPromo> }) => ({
        ...promoRow(),
        ...data,
        id: 'tp-new',
        spentCents: 0,
        status: 'ACTIVE',
      })),
      update: jest.fn(async ({ data }: { data: Partial<TakeawayPromo> }) => {
        row = { ...(row as Row), ...data };
        return row;
      }),
    },
    promo: { findFirst: jest.fn().mockResolvedValue(null) },
    takeawayPromoRedemption: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const service = new TakeawayPromoAdminService(prisma as unknown as PrismaService);
  return { service, prisma, row: () => row };
}

const coded = (status: number, code: string) => ({ status, response: expect.objectContaining({ code }) });

describe('TakeawayPromoAdminService.create', () => {
  it('stores the code uppercase and the name trimmed, ACTIVE, with who made it', async () => {
    const { service, prisma } = harness(null);

    const promo = await service.create(input(), 'admin-1', NOW);

    expect(prisma.takeawayPromo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Осенняя акция',
        code: 'AUTUMN10',
        isWelcome: false,
        createdById: 'admin-1',
      }),
    });
    expect(promo).toMatchObject({ code: 'AUTUMN10', status: 'ACTIVE', leftCents: 100_000, editable: true });
  });

  it.each([
    ['a percent of 0', { percent: 0 }, 400, 'TAKEAWAY_PROMO_PERCENT'],
    ['a percent of 100', { percent: 100 }, 400, 'TAKEAWAY_PROMO_PERCENT'],
    ['a fractional percent', { percent: 12.5 }, 400, 'TAKEAWAY_PROMO_PERCENT'],
    ['an end before the start', { endsAt: day(-1).toISOString() }, 400, 'TAKEAWAY_PROMO_DATES'],
    ['an empty budget', { budgetCents: 0 }, 400, 'TAKEAWAY_PROMO_BUDGET'],
  ])('refuses %s', async (_label, over, status, code) => {
    const { service, prisma } = harness(null);
    await expect(service.create(input(over), 'admin-1', NOW)).rejects.toMatchObject(coded(status, code));
    expect(prisma.takeawayPromo.create).not.toHaveBeenCalled();
  });

  it('refuses a code any brand promo has, in any case (one code field, §2.1)', async () => {
    const { service, prisma } = harness(null);
    prisma.promo.findFirst.mockResolvedValue({ id: 'brand-promo' });

    await expect(service.create(input(), 'admin-1', NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_CODE_TAKEN'),
    );
    expect(prisma.promo.findFirst).toHaveBeenCalledWith({
      where: { code: { equals: 'AUTUMN10', mode: 'insensitive' } },
      select: { id: true },
    });
  });

  it('refuses a code another takeAway promo has, also when two admins race (P2002)', async () => {
    const taken = harness(null);
    taken.prisma.takeawayPromo.findUnique.mockResolvedValue(promoRow({ id: 'tp-other' }));
    await expect(taken.service.create(input(), 'admin-1', NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_CODE_TAKEN'),
    );

    const raced = harness(null);
    raced.prisma.takeawayPromo.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(raced.service.create(input(), 'admin-1', NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_CODE_TAKEN'),
    );
  });

  it('keeps one live welcome promo', async () => {
    const { service, prisma } = harness(null);
    prisma.takeawayPromo.findFirst.mockResolvedValue({ name: 'Старый бонус', code: 'HELLO' });

    await expect(service.create(input({ isWelcome: true }), 'admin-1', NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_WELCOME_TAKEN'),
    );
    expect(prisma.takeawayPromo.findFirst).toHaveBeenCalledWith({
      where: { isWelcome: true, status: 'ACTIVE', endsAt: { gte: NOW } },
      select: { name: true, code: true },
    });

    prisma.takeawayPromo.findFirst.mockResolvedValue(null);
    await expect(service.create(input({ isWelcome: true }), 'admin-1', NOW)).resolves.toMatchObject({
      isWelcome: true,
    });
  });
});

describe('TakeawayPromoAdminService.update (§2.7)', () => {
  it('changes anything while nobody used the promo, under a row lock', async () => {
    const { service, prisma } = harness(promoRow());

    const promo = await service.update('tp-1', { percent: 15, code: 'autumn15', currency: 'RUP' }, NOW);

    expect(promo).toMatchObject({ percent: 15, code: 'AUTUMN15', currency: 'RUP' });
    expect((prisma.$queryRaw.mock.calls[0]?.[0] as string[]).join('?')).toContain('FOR UPDATE');
  });

  it('freezes the percent, code, currency, start and the welcome flag once used', async () => {
    const { service, prisma } = harness(promoRow({}, 3));

    await expect(service.update('tp-1', { percent: 15 }, NOW)).rejects.toMatchObject(coded(409, 'TAKEAWAY_PROMO_USED'));
    for (const change of [
      { code: 'OTHER' },
      { currency: 'RUP' },
      { startsAt: day(-3).toISOString() },
      { isWelcome: true },
    ]) {
      await expect(service.update('tp-1', change, NOW)).rejects.toMatchObject(coded(409, 'TAKEAWAY_PROMO_USED'));
    }
    expect(prisma.takeawayPromo.update).not.toHaveBeenCalled();
  });

  it('takes the name, the end and the budget of a used promo — and frozen fields sent unchanged', async () => {
    const { service } = harness(promoRow({ spentCents: 5_000 }, 3));

    const promo = await service.update(
      'tp-1',
      {
        name: 'Осень+',
        endsAt: day(60).toISOString(),
        budgetCents: 200_000,
        percent: 10,
        code: 'autumn10',
        currency: 'MDL',
        startsAt: day(-1).toISOString(),
      },
      NOW,
    );

    expect(promo).toMatchObject({ name: 'Осень+', budgetCents: 200_000, leftCents: 195_000, editable: false });
  });

  it('never takes the budget below what was spent', async () => {
    const { service } = harness(promoRow({ spentCents: 5_000 }, 3));
    await expect(service.update('tp-1', { budgetCents: 4_999 }, NOW)).rejects.toMatchObject(
      coded(400, 'TAKEAWAY_PROMO_BUDGET'),
    );
  });

  it('exhausts a running promo whose budget is cut down to what was spent', async () => {
    const { service, prisma } = harness(promoRow({ spentCents: 5_000 }, 3));

    const promo = await service.update('tp-1', { budgetCents: 5_000 }, NOW);

    expect(promo.status).toBe('EXHAUSTED');
    expect(prisma.takeawayPromo.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXHAUSTED', exhaustedAt: NOW }) }),
    );
  });

  it('refuses a code a brand promo has', async () => {
    const { service, prisma } = harness(promoRow());
    prisma.promo.findFirst.mockResolvedValue({ id: 'brand-promo' });
    await expect(service.update('tp-1', { code: 'coffee15' }, NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_CODE_TAKEN'),
    );
  });

  it('refuses to make a second live welcome promo', async () => {
    const { service, prisma } = harness(promoRow());
    prisma.takeawayPromo.findFirst.mockResolvedValue({ name: 'Бонус', code: 'HELLO' });
    await expect(service.update('tp-1', { isWelcome: true }, NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_WELCOME_TAKEN'),
    );
    expect(prisma.takeawayPromo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'tp-1' } }) }),
    );
  });

  it('answers 404 for an unknown promo', async () => {
    const { service } = harness(null);
    await expect(service.update('tp-x', { name: 'x' }, NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe('TakeawayPromoAdminService.updateStatus', () => {
  it('switches a running promo off', async () => {
    const { service } = harness(promoRow());
    await expect(service.updateStatus('tp-1', { status: 'DISABLED' }, NOW)).resolves.toMatchObject({
      status: 'DISABLED',
      effectiveStatus: 'DISABLED',
    });
  });

  it('switches an exhausted promo back on only once its budget has room', async () => {
    const full = harness(promoRow({ status: 'EXHAUSTED', spentCents: 100_000, exhaustedAt: day(-1) }));
    await expect(full.service.updateStatus('tp-1', { status: 'ACTIVE' }, NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_BUDGET'),
    );

    const raised = harness(promoRow({ status: 'EXHAUSTED', spentCents: 100_000, budgetCents: 150_000 }));
    await expect(raised.service.updateStatus('tp-1', { status: 'ACTIVE' }, NOW)).resolves.toMatchObject({
      status: 'ACTIVE',
      leftCents: 50_000,
    });
    expect(raised.prisma.takeawayPromo.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE', exhaustedAt: null } }),
    );
  });

  it('does not switch on a promo past its end', async () => {
    const { service } = harness(promoRow({ status: 'DISABLED', endsAt: day(-1) }));
    await expect(service.updateStatus('tp-1', { status: 'ACTIVE' }, NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_STATUS'),
    );
  });

  it('does not switch on a second live welcome promo', async () => {
    const { service, prisma } = harness(promoRow({ status: 'DISABLED', isWelcome: true }));
    prisma.takeawayPromo.findFirst.mockResolvedValue({ name: 'Бонус', code: 'HELLO' });
    await expect(service.updateStatus('tp-1', { status: 'ACTIVE' }, NOW)).rejects.toMatchObject(
      coded(409, 'TAKEAWAY_PROMO_WELCOME_TAKEN'),
    );
  });

  it('leaves a promo already in that status as it is', async () => {
    const { service, prisma } = harness(promoRow({ status: 'DISABLED' }));
    await expect(service.updateStatus('tp-1', { status: 'DISABLED' }, NOW)).resolves.toMatchObject({
      status: 'DISABLED',
    });
    expect(prisma.takeawayPromo.update).not.toHaveBeenCalled();
  });
});

describe('TakeawayPromoAdminService reports', () => {
  const paidOut = { id: 'payout-1', status: 'CONFIRMED' as const, confirmedAt: new Date('2026-11-12T10:00:00Z') };
  const fixed = { id: 'payout-2', status: 'PENDING' as const, confirmedAt: null };
  const rows = () => [
    // Accepted — counts on its accept.
    redemptionRow({ userId: 'u-1', storeId: 's-1', storeName: 'Центр', discountCents: 1_000, payout: paidOut }),
    // Paid by card, not accepted yet — counts on the capture.
    redemptionRow({
      userId: 'u-2',
      storeId: 's-2',
      storeName: 'Вокзал',
      acceptedAt: null,
      capturedAt: [new Date('2026-11-11T08:00:00Z')],
      menuTotalCents: 1_555,
      discountCents: 156,
      payout: fixed,
    }),
    // Waiting for its payment: holds the budget, owes nothing yet.
    redemptionRow({ userId: 'u-3', orderStatus: 'CREATED', acceptedAt: null }),
    // Another brand, another currency.
    redemptionRow({
      userId: 'u-1',
      brandId: 'brand-2',
      brandName: 'Бублик',
      storeId: 's-3',
      currency: 'RUP',
      discountCents: 500,
    }),
  ];

  it('reports counted orders only, by brand, store and UTC day', async () => {
    const { service, prisma } = harness(promoRow({}, 4));
    prisma.takeawayPromoRedemption.findMany.mockResolvedValue(rows());

    const report = await service.report('tp-1', NOW);

    expect(prisma.takeawayPromoRedemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ promoId: 'tp-1' }, { order: { status: { notIn: ['CANCELLED', 'EXPIRED'] } } }] },
      }),
    );
    expect(report).toMatchObject({ orders: 3, customers: 2, discountCents: 1_656 });
    expect(report.byBrand.map((b) => [b.brandName, b.orders, b.discountCents])).toEqual([
      ['NoName Coffee', 2, 1_156],
      ['Бублик', 1, 500],
    ]);
    expect(report.byStore.map((s) => [s.storeName, s.discountCents])).toEqual([
      ['Центр', 1_000],
      ['Центр', 500],
      ['Вокзал', 156],
    ]);
    expect(report.byDay).toEqual([
      { date: '2026-11-10', orders: 2, discountCents: 1_500 },
      { date: '2026-11-11', orders: 1, discountCents: 156 },
    ]);
  });

  it('sums the debt per brand and currency: accrued − repaid, with what is in a payout', async () => {
    const { service, prisma } = harness();
    prisma.takeawayPromoRedemption.findMany.mockResolvedValue(rows());

    const debt = await service.debt();

    // By name, as a Russian list sorts them.
    expect(debt.rows).toEqual([
      {
        brandId: 'brand-2',
        brandName: 'Бублик',
        currency: 'RUP',
        accruedCents: 500,
        inPayoutCents: 0,
        repaidCents: 0,
        debtCents: 500,
      },
      {
        brandId: 'brand-1',
        brandName: 'NoName Coffee',
        currency: 'MDL',
        accruedCents: 1_156,
        inPayoutCents: 156,
        repaidCents: 1_000,
        debtCents: 156,
      },
    ]);
    expect(debt.totals).toEqual([
      { currency: 'MDL', accruedCents: 1_156, repaidCents: 1_000, inPayoutCents: 156, debtCents: 156 },
      { currency: 'RUP', accruedCents: 500, repaidCents: 0, inPayoutCents: 0, debtCents: 500 },
    ]);
  });
});
