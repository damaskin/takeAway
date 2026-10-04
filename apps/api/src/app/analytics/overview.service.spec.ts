import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { resolveDateRange } from './analytics-range';
import { OverviewService } from './overview.service';

const WEEK = resolveDateRange({ from: '2026-09-28', to: '2026-10-04' }, 'Europe/Chisinau', 30);

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
          stores: [{ id: 's1', timezone: 'Europe/Chisinau' }],
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
    await service.business({ brandIds: ['b1'], storeIds: null }, WEEK, { storeComparison: true, deep: true });

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
    const o = await service.business({ brandIds: ['b1'], storeIds: null }, WEEK, {
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
    await service.business({ brandIds: ['b1'], storeIds: null }, WEEK, { storeComparison: true, deep: true });
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
    const o = await service.business({ brandIds: ['b1'], storeIds: null }, WEEK, {
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
