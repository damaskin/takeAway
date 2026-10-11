import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { resolveDateRange } from './analytics-range';
import type { AnalyticsScope } from './analytics-scope';
import { OverviewService } from './overview.service';

const WEEK = resolveDateRange({ from: '2026-09-28', to: '2026-10-04' }, 'Europe/Chisinau', 30);

/** What the controller hands over: the scope, the wider view it is part of, the days and the currency. */
function ctx(scope: AnalyticsScope, parent: AnalyticsScope = scope, storeId: string | null = null) {
  return { scope, parent, storeId, range: WEEK, currency: 'MDL', currencies: ['MDL'] };
}

/** One row of the GROUPING SETS query. */
function group(key: string | null, current: boolean, orders: number, revenue: number, customers = orders) {
  return {
    key,
    current,
    orders,
    revenue: BigInt(revenue),
    sales: BigInt(revenue + 500),
    discounts: 500n,
    giftCards: 0n,
    commission: revenue * 0.15,
    placed: orders,
    cancelled: 0,
    expired: 0,
    pickupSecSum: 0,
    pickupCount: 0,
    customers,
  };
}

/** The SQL and the bound values of one `$queryRaw` tagged-template call. */
function query(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
}

function setup(rows: (sql: string) => unknown[] = () => []) {
  const $queryRaw = jest.fn((...call: unknown[]) => Promise.resolve(rows(query(call).sql)));
  const prisma = {
    $queryRaw,
    store: {
      findMany: jest.fn().mockResolvedValue([
        { id: 's1', name: 'Center', timezone: 'Europe/Chisinau' },
        { id: 's2', name: 'Mall', timezone: 'UTC' },
      ]),
    },
    brand: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'b1',
          name: 'Alpha',
          currency: 'MDL',
          plan: 'PRO',
          commissionBps: 1500,
          moderationStatus: 'APPROVED',
          stores: [
            { id: 's1', timezone: 'Europe/Chisinau', currency: 'MDL' },
            // Opened in another currency: never added to Alpha's lei.
            { id: 's9', timezone: 'Europe/Chisinau', currency: 'RUP' },
          ],
        },
        {
          id: 'b2',
          name: 'Beta',
          currency: 'RUP',
          plan: 'BASIC',
          commissionBps: 1000,
          moderationStatus: 'APPROVED',
          stores: [],
        },
      ]),
    },
  } as unknown as PrismaService;
  return { service: new OverviewService(prisma), $queryRaw, prisma };
}

describe('OverviewService.business', () => {
  it('stays inside the scope and binds instants as UTC timestamps', async () => {
    const { service, $queryRaw } = setup();
    await service.business(ctx({ brandIds: ['b1'], storeIds: null }), { storeComparison: true, deep: true });

    expect($queryRaw).toHaveBeenCalledTimes(5);
    for (const call of $queryRaw.mock.calls) {
      const sql = query(call);
      expect(sql.sql).toContain('s."brandId" = ANY(');
      expect(sql.values).toContainEqual(['b1']);
      // A bound Date would compare through the session's TimeZone.
      expect(sql.values.some((v) => v instanceof Date)).toBe(false);
      expect(sql.sql).toMatch(/::timestamp/);
    }
  });

  it('skips the hourly load without deepAnalytics and nulls the PRO parts', async () => {
    const { service, $queryRaw } = setup();
    const o = await service.business(ctx({ brandIds: ['b1'], storeIds: null }), {
      storeComparison: false,
      deep: false,
    });
    expect($queryRaw).toHaveBeenCalledTimes(4);
    expect($queryRaw.mock.calls.some((c) => query(c).sql.includes('ISODOW'))).toBe(false);
    expect(o.byHour).toBeNull();
    expect(o.byWeekday).toBeNull();
    expect(o.storeComparison).toBe(false);
    // Idle stores are listed all the same.
    expect(o.byStore.map((s) => [s.name, s.detailed])).toEqual([
      ['Center', false],
      ['Mall', false],
    ]);
  });

  it('reads each store at its own zone, borrowing the period zone for a UTC placeholder', async () => {
    const { service, $queryRaw } = setup();
    await service.business(ctx({ brandIds: ['b1'], storeIds: null }), { storeComparison: true, deep: true });
    const load = $queryRaw.mock.calls.map(query).find((q) => q.sql.includes('ISODOW'));
    expect(load?.values).toContainEqual(['s1', 's2']);
    expect(load?.values).toContainEqual(['Europe/Chisinau', 'Europe/Chisinau']);
  });

  it('turns the grouped rows into totals', async () => {
    const { service } = setup((sql) =>
      sql.includes('GROUPING SETS')
        ? [
            {
              key: null,
              current: true,
              orders: 2,
              revenue: 3000n,
              commission: 450,
              placed: 3,
              cancelled: 1,
              expired: 0,
              pickupSecSum: 0,
              pickupCount: 0,
              customers: 2,
            },
            {
              key: 's1',
              current: true,
              orders: 2,
              revenue: 3000n,
              commission: 450,
              placed: 3,
              cancelled: 1,
              expired: 0,
              pickupSecSum: 0,
              pickupCount: 0,
              customers: 2,
            },
            {
              key: null,
              current: false,
              orders: 1,
              revenue: 1000n,
              commission: 150,
              placed: 1,
              cancelled: 0,
              expired: 0,
              pickupSecSum: 0,
              pickupCount: 0,
              customers: 1,
            },
          ]
        : sql.includes('"firstAt"')
          ? [
              { day: '2026-09-29', customers: 1n },
              { day: '2026-09-22', customers: 1n },
            ]
          : [],
    );
    const o = await service.business(ctx({ brandIds: ['b1'], storeIds: null }), {
      storeComparison: true,
      deep: false,
    });
    expect(o.current).toEqual(
      expect.objectContaining({
        revenueCents: 3000,
        orders: 2,
        newCustomers: 1,
        cancelRatePercent: 33.3,
        activeUnits: 1,
      }),
    );
    expect(o.previous).toEqual(expect.objectContaining({ revenueCents: 1000, newCustomers: 1 }));
    expect(o.byStore[0]).toEqual(expect.objectContaining({ id: 's1', sharePercent: 100 }));
    expect(o.daily[1]?.newCustomers).toBe(1);
    expect([o.currency, o.currencies]).toEqual(['MDL', ['MDL']]);
  });

  it('counts revenue as sales less discounts everywhere, never the card charge', async () => {
    const { service, $queryRaw } = setup();
    await service.business(ctx({ brandIds: ['b1'], storeIds: null }), { storeComparison: true, deep: true });
    const money = $queryRaw.mock.calls.map(query).filter((q) => q.sql.includes('"revenue"'));
    expect(money.length).toBeGreaterThanOrEqual(3);
    for (const q of money) {
      expect(q.sql).toContain('GREATEST(o."subtotalCents" - o."discountCents", 0)');
      expect(q.sql).not.toContain('o."totalCents"');
    }
  });

  it('narrowed to one store, shows its own row as the totals and still lists every store', async () => {
    const brand = { brandIds: ['b1'], storeIds: null };
    const picked = { brandIds: ['b1'], storeIds: ['s2'] };
    const { service, $queryRaw } = setup((sql) =>
      sql.includes('GROUPING SETS')
        ? [
            group(null, true, 5, 7000, 4),
            group('s1', true, 5, 7000, 4),
            group(null, false, 2, 3000),
            group('s1', false, 2, 3000),
          ]
        : [],
    );
    const o = await service.business(ctx(picked, brand, 's2'), { storeComparison: true, deep: true });

    // test2 had nothing: its own zeros, not the brand's figures, and no store active.
    expect(o.current).toEqual(expect.objectContaining({ revenueCents: 0, orders: 0, customers: 0, activeUnits: 0 }));
    expect(o.previous.revenueCents).toBe(0);
    // Both stores stay on the panel, so another one is a click away.
    expect(o.byStore.map((s) => [s.id, s.revenueCents, s.sharePercent])).toEqual([
      ['s1', 7000, 100],
      ['s2', 0, 0],
    ]);
    const queries = $queryRaw.mock.calls.map(query);
    const grouped = queries.find((q) => q.sql.includes('GROUPING SETS'));
    expect(grouped?.values).not.toContainEqual(['s2']);
    // Days, first orders, load and statuses are the store's own.
    for (const q of queries.filter((x) => x !== grouped)) expect(q.values).toContainEqual(['s2']);
  });

  it("takes a picked store's totals from its row of the brand query", async () => {
    const brand = { brandIds: ['b1'], storeIds: null };
    const { service } = setup((sql) =>
      sql.includes('GROUPING SETS')
        ? [group(null, true, 5, 7000, 4), group('s1', true, 3, 4000, 2), group('s2', true, 2, 3000, 2)]
        : [],
    );
    const o = await service.business(ctx({ brandIds: ['b1'], storeIds: ['s1'] }, brand, 's1'), {
      storeComparison: true,
      deep: false,
    });
    expect(o.current).toEqual(
      expect.objectContaining({ revenueCents: 4000, salesCents: 4500, orders: 3, customers: 2, activeUnits: 1 }),
    );
    expect(o.byStore.find((s) => s.id === 's1')).toEqual(
      expect.objectContaining({ revenueCents: 4000, orders: 3, sharePercent: 57.1 }),
    );
  });
});

describe('OverviewService.platform', () => {
  it('covers the brands of the requested currency only', async () => {
    const { service, $queryRaw } = setup();
    const p = await service.platform({ from: '2026-09-28', to: '2026-10-04' }, 'MDL');
    expect(p.currency).toBe('MDL');
    expect(p.currencies).toEqual(['MDL', 'RUP']);
    expect(p.period.timeZone).toBe('Europe/Chisinau');
    expect(p.byBrand.map((b) => [b.name, b.plan, b.commissionBps, b.stores])).toEqual([['Alpha', 'PRO', 1500, 1]]);
    const grouped = $queryRaw.mock.calls.map(query).find((q) => q.sql.includes('GROUPING SETS'));
    expect(grouped?.values).toContainEqual(['b1']);
    expect(grouped?.values).toContainEqual(['s1']);
    expect(grouped?.sql).toContain('s."brandId" AS "key"');
  });

  it('opens on the currency that sold the most when none is asked for', async () => {
    const { service } = setup((sql) =>
      sql.includes('GROUPING SETS') || !sql.includes('"brandId" AS "brandId"')
        ? []
        : [
            { brandId: 'b1', revenue: 100n },
            { brandId: 'b2', revenue: 900n },
          ],
    );
    const p = await service.platform({ days: 7 });
    expect(p.currency).toBe('RUP');
    expect(p.byBrand.map((b) => b.id)).toEqual(['b2']);
    // Gamma has no store with a zone: the platform's days fall back to UTC.
    expect(p.period.timeZone).toBe('UTC');
  });
});
