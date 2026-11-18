import { PrismaClient } from '@prisma/client';

import { inactiveCustomerIds } from '../customers/customer-segment';
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

/**
 * Regulars who went quiet, for the inactive-now check: one at the centre
 * since 9 August (every 4 days before), one at test2 since July, one who
 * stopped on 25 September (inactive for 14 days, not for 30) and one who
 * came only twice (never a regular).
 */
const QUIET: Array<{ userId: string; storeId: string; days: string[] }> = [
  { userId: 'it-quiet-centre', storeId: CENTER, days: ['2026-08-01', '2026-08-05', '2026-08-09'] },
  { userId: 'it-quiet-test2', storeId: TEST2, days: ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22'] },
  { userId: 'it-quiet-recent', storeId: CENTER, days: ['2026-09-11', '2026-09-18', '2026-09-25'] },
  { userId: 'it-twice', storeId: CENTER, days: ['2026-08-01', '2026-08-02'] },
];
const QUIET_ORDERS = QUIET.flatMap((q) => q.days.map((_, i) => `${q.userId}-${i}`));

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
  // The regular came three times in August (the win-back threshold is three
  // orders) and then stayed away: a returning customer this week.
  {
    id: 'it-o6a',
    userId: 'it-regular',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-08-07T07:00:00Z',
    lines: [americano()],
  },
  {
    id: 'it-o6b',
    userId: 'it-regular',
    storeId: CENTER,
    status: 'PICKED_UP',
    createdAt: '2026-08-11T07:00:00Z',
    lines: [americano()],
  },
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
  // The regular also went to test2 three times in August and never again:
  // inactive there, active across the stores.
  ...['2026-08-05', '2026-08-08', '2026-08-12'].map(
    (day, i): Seed => ({
      id: `it-t2-${i}`,
      userId: 'it-regular',
      storeId: TEST2,
      status: 'PICKED_UP',
      createdAt: `${day}T07:00:00Z`,
      lines: [americano()],
    }),
  ),
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
).map((s) => ({
  ...s,
  subtotalCents: subtotal(s),
  discountCents: discount(s),
  pointsDiscountCents: s.points ?? 0,
  giftCardCents: s.giftCard ?? 0,
}));

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
    expect(expected).toEqual({ salesCents: 10_400, discountCents: 1_400, revenueCents: 9_000, giftCardCents: 1_400 });
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
          order: {
            subtotalCents: o.subtotalCents,
            discountCents: o.discountCents,
            pointsDiscountCents: o.pointsDiscountCents,
          },
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
      avgBasketCents: 1_800,
    });
  });

  it('gives the dashboard the same numbers, and a picked store its own', async () => {
    const ctx = { range: WEEK, currency: 'RUP', currencies: ['MDL', 'RUP'] };
    const all = await overview.business(
      { ...ctx, scope: roubles, parent: roubles, storeId: null },
      { storeComparison: true, deep: true },
    );
    expect(all.current).toMatchObject({
      revenueCents: 9_000,
      salesCents: 10_400,
      discountCents: 1_400,
      giftCardCents: 1_400,
      orders: 5,
      placed: 6,
      customers: 2,
      newCustomers: 1,
      returningCustomers: 1,
      avgCheckCents: 1_800,
      // 15 % of the revenue less the 14 paid by gift card.
      commissionCents: 1_140,
    });
    expect(all.daily.reduce((sum, d) => sum + d.revenueCents, 0)).toBe(9_000);
    expect(all.byStore.map((s) => [s.id, s.revenueCents])).toEqual([
      [CENTER, 9_000],
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
    expect(center.current).toMatchObject({ revenueCents: 9_000, orders: 5, customers: 2, activeUnits: 1 });
  });

  it('runs every other money query on the same basis, one currency at a time', async () => {
    const stores = await analytics.storePerformance(roubles, WEEK, true);
    expect(stores.map((s) => [s.storeId, s.revenueCents, s.currency])).toEqual([
      [CENTER, 9_000, 'RUP'],
      [TEST2, 0, 'RUP'],
    ]);
    await expect(analytics.dashboardSummary(roubles, WEEK)).resolves.toMatchObject({
      revenueCents: 9_000,
      orders: 5,
    });
    const now = new Date('2026-10-10T00:00:00Z');
    // The regular had been away since August and came back on the 4th.
    const winBack = await analytics.winBack(roubles, WEEK, 14, 20, now);
    expect(winBack.current).toMatchObject({ returned: 1, orders: 1, revenueCents: 1_400 });
    await expect(analytics.churn(roubles, WEEK, 14, true, 20, now)).resolves.toMatchObject({ count: 0 });

    const p = await overview.platform({ from: WEEK.from, to: WEEK.to }, 'RUP');
    expect(p.byBrand.find((b) => b.id === BRAND)).toMatchObject({ revenueCents: 9_000, commissionCents: 1_140 });

    await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW "mv_orders_daily"');
    const brands = await analytics.brandPerformance(3650);
    // Every counted rouble order, August's six too; the sale in lei stays out.
    expect(brands.find((b) => b.brandId === BRAND)).toMatchObject({ revenueCents: 17_400, orders: 11 });
  });

  it('names who went quiet at one store but still orders at another', async () => {
    const customers = new CustomersService(prisma as unknown as PrismaService);
    const now = new Date('2026-10-10T00:00:00Z');
    const page = await customers.list(roubles, { segment: 'inactive', inactiveDays: 14 } as CustomersQueryDto, now);
    expect(page.items.map((c) => c.userId)).not.toContain('it-regular');
    expect(page.activeElsewhere).toMatchObject({ count: 1, stores: [{ storeId: TEST2, count: 1 }] });
  });

  it("counts a customer's spend on the revenue basis", async () => {
    const customers = new CustomersService(prisma as unknown as PrismaService);
    const page = await customers.list(roubles, { page: 1, pageSize: 10, sort: 'totalCents' } as CustomersQueryDto);
    const tester = page.items.find((c) => c.userId === 'it-tester');
    // 28 + 0 + 14 + 34 roubles — the gift-card order counts, the points are takeAway's to pay, the cancelled one does not count.
    expect(tester).toMatchObject({ orders: 4, totalCents: 7_600, avgCheckCents: 1_900 });
    const detail = await customers.detail(roubles, 'it-tester');
    const counted = detail.recentOrders.filter((o) => o.status !== 'CANCELLED');
    expect(counted.reduce((sum, o) => sum + o.totalCents, 0)).toBe(detail.totalCents);
  });

  it('estimates lost revenue as days away ÷ usual interval × average check, on visit days', async () => {
    // At test2 the regular came on 5, 8 and 12 August (T = 3.5 days) and the
    // one-timer three times on the 11th — one visit, so the brand's T applies.
    await prisma.user.create({ data: { id: 'it-once', name: 'Один раз' } });
    for (const [i, hour] of ['07', '08', '09'].entries()) {
      const at = new Date(`2026-08-11T${hour}:00:00Z`);
      await prisma.order.create({
        data: {
          id: `it-once-${i}`,
          userId: 'it-once',
          storeId: TEST2,
          status: 'PICKED_UP',
          pickupAt: at,
          createdAt: at,
          subtotalCents: AMERICANO,
          totalCents: AMERICANO,
          currency: 'RUP',
          orderCode: `it-once-${i}`,
          qrToken: `it-once-${i}`,
        },
      });
    }
    const august = resolveDateRange({ from: '2026-08-24', to: '2026-08-30' }, 'Europe/Chisinau', 7);
    const test2: AnalyticsScope = { brandIds: [BRAND], storeIds: [TEST2] };
    const churn = await analytics.churn(test2, august, 14, true, 20, new Date('2026-10-10T00:00:00Z'));
    const byUser = new Map((churn.customers ?? []).map((c) => [c.userId, c]));
    expect(byUser.get('it-regular')).toMatchObject({ visits: 3, visitIntervalDays: 3.5 });
    expect(byUser.get('it-once')).toMatchObject({ visits: 1 });
    const regular = byUser.get('it-regular');
    const once = byUser.get('it-once');
    expect(regular?.lostRevenueCents).toBe(Math.round((regular!.daysSinceLastOrder / 3.5) * AMERICANO));
    expect(once?.lostRevenueCents).toBe(Math.round((once!.daysSinceLastOrder / 3.5) * AMERICANO));
    expect(churn.lostRevenueCents).toBe(regular!.lostRevenueCents + once!.lostRevenueCents);
  });

  it('shows the same inactive people on the card, in «Возврат клиентов» and in «Клиенты → Неактивные» for N = 30', async () => {
    await prisma.user.createMany({ data: QUIET.map((q) => ({ id: q.userId, name: q.userId })) });
    for (const q of QUIET) {
      for (const [i, day] of q.days.entries()) {
        const at = new Date(`${day}T07:00:00Z`);
        await prisma.order.create({
          data: {
            id: `${q.userId}-${i}`,
            userId: q.userId,
            storeId: q.storeId,
            status: 'PICKED_UP',
            pickupAt: at,
            createdAt: at,
            subtotalCents: AMERICANO,
            totalCents: AMERICANO,
            currency: 'RUP',
            orderCode: `${q.userId}-${i}`,
            qrToken: `${q.userId}-${i}`,
          },
        });
      }
    }
    const customers = new CustomersService(prisma as unknown as PrismaService);
    const now = new Date('2026-10-10T00:00:00Z');
    // The brand prices in roubles and lei: people are counted over every store, money in roubles.
    const money = { currency: 'RUP', currencies: ['MDL', 'RUP'] };
    const options = { timeZone: 'Europe/Chisinau', ...money };
    const brand: AnalyticsScope = { brandIds: [BRAND], storeIds: null };
    const test2: AnalyticsScope = { brandIds: [BRAND], storeIds: [TEST2] };

    for (const scope of [brand, roubles, test2]) {
      // The card names its top three; the tab asks for the count alone; the
      // list pages the segment; a campaign is sent to it.
      const card = await analytics.inactiveNow(scope, 30, { ...options, withList: true, take: 100 }, now);
      const tab = await analytics.inactiveNow(scope, 30, { ...options, withList: true, take: 0 }, now);
      const list = await customers.list(
        scope,
        { segment: 'inactive', inactiveDays: 30, pageSize: 100 } as CustomersQueryDto,
        now,
        money,
      );
      const audience = await inactiveCustomerIds(prisma as unknown as PrismaService, scope, 30, now);
      const people = list.items.map((c) => c.userId).sort();
      expect(people.length).toBeGreaterThan(0);
      expect(card.count).toBe(list.total);
      expect(tab.count).toBe(list.total);
      expect((card.customers ?? []).map((c) => c.userId).sort()).toEqual(people);
      expect([...audience].sort()).toEqual(people);
      expect(card.activeElsewhere).toEqual(scope === test2 ? null : list.activeElsewhere);
    }

    const card = await analytics.inactiveNow(brand, 30, { ...options, withList: true, take: 100 }, now);
    const ids = (card.customers ?? []).map((c) => c.userId);
    expect(ids).toEqual(expect.arrayContaining(['it-quiet-centre', 'it-quiet-test2']));
    expect(ids).not.toContain('it-quiet-recent');
    expect(ids).not.toContain('it-twice');
    // 62 days since 9 August, a visit every 4 days, 14 roubles: 62 ÷ 4 × 1 400 = 21 700.
    expect(card.customers?.find((c) => c.userId === 'it-quiet-centre')).toMatchObject({
      daysSinceLastOrder: 62,
      visitIntervalDays: 4,
      lostRevenueCents: 21_700,
    });
    expect(card.lostRevenueCents).toBe((card.customers ?? []).reduce((sum, c) => sum + c.lostRevenueCents, 0));

    // Fourteen days take in the one who stopped on 25 September, on the card and in the list alike.
    const fortnight = await analytics.inactiveNow(brand, 14, { ...options, withList: false, take: 0 }, now);
    const fortnightList = await customers.list(
      brand,
      { segment: 'inactive', inactiveDays: 14, pageSize: 100 } as CustomersQueryDto,
      now,
      money,
    );
    expect(fortnight.count).toBe(card.count + 1);
    expect(fortnightList.total).toBe(fortnight.count);
    expect(fortnightList.items.map((c) => c.userId)).toContain('it-quiet-recent');
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  const orders = [...SEEDS.map((s) => s.id), 'it-once-0', 'it-once-1', 'it-once-2', ...QUIET_ORDERS];
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } });
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  await prisma.store.deleteMany({ where: { id: { in: [CENTER, TEST2, LEI] } } });
  await prisma.user.deleteMany({
    where: { id: { in: ['it-tester', 'it-regular', 'it-once', ...QUIET.map((q) => q.userId)] } },
  });
  await prisma.brand.deleteMany({ where: { id: BRAND } });
}
