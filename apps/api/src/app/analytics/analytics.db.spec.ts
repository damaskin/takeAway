import { PrismaClient } from '@prisma/client';

import { CustomersService } from '../customers/customers.service';
import type { CustomersQueryDto } from '../customers/dto/customers.dto';
import type { PrismaService } from '../prisma/prisma.service';
import { resolveDateRange } from './analytics-range';
import type { AnalyticsScope } from './analytics-scope';
import { AnalyticsService } from './analytics.service';
import { productRevenue, sumMoney } from './money';
import { OverviewService } from './overview.service';

/**
 * The money queries on a real Postgres, against the definitions in
 * `money.ts`. Opt-in: set ANALYTICS_IT_DATABASE_URL to a throwaway database
 * with the migrations applied (`prisma migrate deploy`). The suite adds one
 * brand with its stores, customers and orders, all with ids starting `it-`,
 * and deletes them again. Never point it at a database you care about.
 */
const url = process.env['ANALYTICS_IT_DATABASE_URL'];
const suite = url ? describe : describe.skip;

const WEEK = resolveDateRange({ from: '2026-09-28', to: '2026-10-04' }, 'Europe/Chisinau', 7);
const BRAND = 'it-brand';
const CENTER = 'it-center';
const TEST2 = 'it-test2';
const LEI = 'it-lei';
const AMERICANO = 1400;
const CROISSANT = 2000;

interface Line {
  name: string;
  quantity: number;
  unitPriceCents: number;
}

interface Seed {
  id: string;
  userId: string;
  storeId: string;
  status: 'PICKED_UP' | 'CANCELLED';
  createdAt: string;
  lines: Line[];
  promo?: number;
  points?: number;
  giftCard?: number;
}

const americano = (quantity = 1): Line => ({ name: 'Американо', quantity, unitPriceCents: AMERICANO });

/** The tester's week at the centre, a regular's visit, a cancelled order and a sale in lei. */
const SEEDS: Seed[] = [
  {
    id: 'it-o1',
    userId: 'it-tester',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-09-29T07:00:00Z',
    lines: [americano(2)],
  },
  {
    id: 'it-o2',
    userId: 'it-tester',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-10-01T07:00:00Z',
    lines: [americano()],
    promo: AMERICANO,
  },
  {
    id: 'it-o3',
    userId: 'it-tester',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-10-02T07:00:00Z',
    lines: [americano()],
    giftCard: AMERICANO,
  },
  {
    id: 'it-o4',
    userId: 'it-tester',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-10-03T07:00:00Z',
    lines: [americano(), { name: 'Круассан', quantity: 1, unitPriceCents: CROISSANT }],
    points: 500,
  },
  {
    id: 'it-o5',
    userId: 'it-tester',
    storeId: CENTER,
    status: 'CANCELLED',
    createdAt: '2026-10-03T08:00:00Z',
    lines: [americano(3)],
  },
  // The regular first came in August: a returning customer this week.
  {
    id: 'it-o6',
    userId: 'it-regular',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-08-14T07:00:00Z',
    lines: [americano()],
  },
  {
    id: 'it-o7',
    userId: 'it-regular',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-10-04T07:00:00Z',
    lines: [americano()],
  },
  // Another currency: never added to the roubles.
  {
    id: 'it-o8',
    userId: 'it-regular',
    storeId: LEI,
    status: 'PICKED_UP',
    createdAt: '2026-10-04T08:00:00Z',
    lines: [americano(5)],
  },
];

const subtotal = (s: Seed) => s.lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
const discount = (s: Seed) => (s.promo ?? 0) + (s.points ?? 0);

/** The week's counted rouble orders, as `money.ts` sees them. */
const WEEK_RUP = SEEDS.filter(
  (s) => s.storeId === CENTER && s.status !== 'CANCELLED' && s.createdAt >= '2026-09-27T21:00:00Z',
).map((s) => ({ ...s, subtotalCents: subtotal(s), discountCents: discount(s), giftCardCents: s.giftCard ?? 0 }));

suite('analytics money on Postgres', () => {
  let prisma: PrismaClient;
  let analytics: AnalyticsService;
  let overview: OverviewService;
  const roubles: AnalyticsScope = { brandIds: [BRAND], storeIds: [CENTER, TEST2] };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    analytics = new AnalyticsService(prisma as unknown as PrismaService);
    overview = new OverviewService(prisma as unknown as PrismaService);
    await cleanUp(prisma);

    await prisma.brand.create({
      data: { id: BRAND, slug: 'it-brand', name: 'IT Качели', currency: 'RUP', plan: 'PRO', commissionBps: 1500 },
    });
    const store = (id: string, name: string, currency: 'RUP' | 'MDL') => ({
      id,
      brandId: BRAND,
      slug: id,
      name,
      addressLine: 'Юности 12',
      city: 'Тирасполь',
      country: 'MD',
      latitude: 46.84,
      longitude: 29.66,
      timezone: 'Europe/Chisinau',
      currency,
    });
    await prisma.store.createMany({
      data: [store(CENTER, 'Центр', 'RUP'), store(TEST2, 'test2', 'RUP'), store(LEI, 'Лей', 'MDL')],
    });
    await prisma.user.createMany({
      data: [
        { id: 'it-tester', name: 'Тестер' },
        { id: 'it-regular', name: 'Постоянный' },
      ],
    });
    for (const s of SEEDS) {
      const sub = subtotal(s);
      const total = Math.max(0, sub - discount(s) - (s.giftCard ?? 0));
      await prisma.order.create({
        data: {
          id: s.id,
          userId: s.userId,
          storeId: s.storeId,
          status: s.status,
          pickupAt: new Date(s.createdAt),
          createdAt: new Date(s.createdAt),
          subtotalCents: sub,
          discountCents: discount(s),
          pointsDiscountCents: s.points ?? 0,
          giftCardCents: s.giftCard ?? 0,
          totalCents: total,
          currency: s.storeId === LEI ? 'MDL' : 'RUP',
          orderCode: s.id,
          qrToken: s.id,
          items: {
            create: s.lines.map((l) => ({
              productSnapshot: { name: l.name },
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              totalCents: l.unitPriceCents * l.quantity,
            })),
          },
        },
      });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanUp(prisma);
    await prisma.$disconnect();
  });

  it('sums revenue as sales less discounts, gift cards included', async () => {
    const r = await analytics.revenueSeries(roubles, WEEK);
    const expected = sumMoney(WEEK_RUP);
    expect(expected).toEqual({ salesCents: 10_400, discountCents: 1_900, revenueCents: 8_500, giftCardCents: 1_400 });
    expect(r).toMatchObject({
      totalRevenueCents: expected.revenueCents,
      salesCents: expected.salesCents,
      discountCents: expected.discountCents,
      giftCardCents: expected.giftCardCents,
      totalOrders: 5,
      previousRevenueCents: 0,
      revenueDeltaPercent: null,
    });
  });

  it('ranks products on the same basis, adding up to no more than the revenue', async () => {
    const top = await analytics.topProducts(roubles, WEEK, 10);
    const mirror = productRevenue(
      WEEK_RUP.flatMap((o) =>
        o.lines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          totalCents: l.unitPriceCents * l.quantity,
          order: { subtotalCents: o.subtotalCents, discountCents: o.discountCents },
        })),
      ),
    );
    expect(top).toEqual(mirror);
    const revenue = sumMoney(WEEK_RUP).revenueCents;
    expect(top.reduce((sum, p) => sum + p.revenueCents, 0)).toBeLessThanOrEqual(revenue);
  });

  it('splits customers into new and returning', async () => {
    await expect(analytics.cohort(roubles, WEEK)).resolves.toMatchObject({
      customers: 2,
      newCustomers: 1,
      returningCustomers: 1,
      repeatRatePercent: 50,
      avgBasketCents: 1_700,
    });
  });

  it('gives the dashboard the same numbers, and a picked store its own', async () => {
    const ctx = { range: WEEK, currency: 'RUP', currencies: ['MDL', 'RUP'] };
    const all = await overview.business(
      { ...ctx, scope: roubles, parent: roubles, storeId: null },
      { storeComparison: true, deep: true },
    );
    expect(all.current).toMatchObject({
      revenueCents: 8_500,
      salesCents: 10_400,
      discountCents: 1_900,
      giftCardCents: 1_400,
      orders: 5,
      placed: 6,
      customers: 2,
      newCustomers: 1,
      returningCustomers: 1,
      avgCheckCents: 1_700,
      // 15 % of the revenue.
      commissionCents: 1_275,
    });
    expect(all.daily.reduce((sum, d) => sum + d.revenueCents, 0)).toBe(8_500);
    expect(all.byStore.map((s) => [s.id, s.revenueCents])).toEqual([
      [CENTER, 8_500],
      [TEST2, 0],
    ]);

    const test2 = await overview.business(
      { ...ctx, scope: { brandIds: [BRAND], storeIds: [TEST2] }, parent: roubles, storeId: TEST2 },
      { storeComparison: true, deep: true },
    );
    expect(test2.current).toMatchObject({ revenueCents: 0, orders: 0, placed: 0, customers: 0, activeUnits: 0 });
    expect(test2.byStore.map((s) => s.id)).toEqual([CENTER, TEST2]);
    expect(test2.daily.every((d) => d.revenueCents === 0)).toBe(true);

    const center = await overview.business(
      { ...ctx, scope: { brandIds: [BRAND], storeIds: [CENTER] }, parent: roubles, storeId: CENTER },
      { storeComparison: true, deep: false },
    );
    expect(center.current).toMatchObject({ revenueCents: 8_500, orders: 5, customers: 2, activeUnits: 1 });
  });

  it('runs every other money query on the same basis, one currency at a time', async () => {
    const stores = await analytics.storePerformance(roubles, WEEK, true);
    expect(stores.map((s) => [s.storeId, s.revenueCents, s.currency])).toEqual([
      [CENTER, 8_500, 'RUP'],
      [TEST2, 0, 'RUP'],
    ]);
    await expect(analytics.dashboardSummary(roubles, WEEK)).resolves.toMatchObject({
      revenueCents: 8_500,
      orders: 5,
    });
    const now = new Date('2026-10-10T00:00:00Z');
    // The regular had been away since August and came back on the 4th.
    const winBack = await analytics.winBack(roubles, WEEK, 14, 20, now);
    expect(winBack.current).toMatchObject({ returned: 1, orders: 1, revenueCents: 1_400 });
    await expect(analytics.churn(roubles, WEEK, 14, true, 20, now)).resolves.toMatchObject({ count: 0 });

    const p = await overview.platform({ from: WEEK.from, to: WEEK.to }, 'RUP');
    expect(p.byBrand.find((b) => b.id === BRAND)).toMatchObject({ revenueCents: 8_500, commissionCents: 1_275 });

    await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW "mv_orders_daily"');
    const brands = await analytics.brandPerformance(3650);
    // Every counted rouble order, August's too; the sale in lei stays out.
    expect(brands.find((b) => b.brandId === BRAND)).toMatchObject({ revenueCents: 9_900, orders: 6 });
  });

  it("counts a customer's spend on the revenue basis", async () => {
    const customers = new CustomersService(prisma as unknown as PrismaService);
    const page = await customers.list(roubles, { page: 1, pageSize: 10, sort: 'totalCents' } as CustomersQueryDto);
    const tester = page.items.find((c) => c.userId === 'it-tester');
    // 28 + 0 + 14 + 29 roubles — the gift-card order counts, the cancelled one does not.
    expect(tester).toMatchObject({ orders: 4, totalCents: 7_100, avgCheckCents: 1_775 });
    const detail = await customers.detail(roubles, 'it-tester');
    const counted = detail.recentOrders.filter((o) => o.status !== 'CANCELLED');
    expect(counted.reduce((sum, o) => sum + o.totalCents, 0)).toBe(detail.totalCents);
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  const orders = SEEDS.map((s) => s.id);
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } });
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  await prisma.store.deleteMany({ where: { id: { in: [CENTER, TEST2, LEI] } } });
  await prisma.user.deleteMany({ where: { id: { in: ['it-tester', 'it-regular'] } } });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
