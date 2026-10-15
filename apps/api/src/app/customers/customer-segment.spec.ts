import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import {
  inactiveAtOneStoreOnly,
  inactiveBefore,
  inactiveCustomerIds,
  isInactive,
  isInactiveCustomer,
  perCustomerSql,
  segmentSql,
} from './customer-segment';

const NOW = new Date('2026-10-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60_000);

describe('isInactive', () => {
  it('needs 3 orders and none for the whole window', () => {
    expect(isInactive({ orders: 3, lastOrderAt: daysAgo(8) }, 7, NOW)).toBe(true);
    expect(isInactive({ orders: 3, lastOrderAt: daysAgo(6) }, 7, NOW)).toBe(false);
    expect(isInactive({ orders: 2, lastOrderAt: daysAgo(30) }, 7, NOW)).toBe(false);
  });

  it('takes the 3-day window', () => {
    expect(inactiveBefore(3, NOW).toISOString()).toBe('2026-10-07T12:00:00.000Z');
    expect(isInactive({ orders: 10, lastOrderAt: daysAgo(4) }, 3, NOW)).toBe(true);
  });
});

describe('segmentSql', () => {
  it('means everyone for all', () => {
    expect(segmentSql('all', 14, NOW)).toBeNull();
  });

  it('asks only for 3 orders for regulars', () => {
    const sql = segmentSql('regular', 14, NOW);
    expect(sql?.sql).toBe('p."orders" >= ?');
    expect(sql?.values).toEqual([3]);
  });

  it('adds the cut-off for the inactive', () => {
    const sql = segmentSql('inactive', 7, NOW);
    expect(sql?.sql).toContain('p."lastOrderAt" <');
    expect(sql?.values).toEqual([3, '2026-10-03T12:00:00.000Z']);
  });
});

describe('perCustomerSql', () => {
  it('counts only what the analytics counts, for the scope, without deleted accounts', () => {
    const sql = perCustomerSql({ brandIds: ['b1'], storeIds: ['s1'] }, 'u1');
    expect(sql.sql).toContain(`o."status" NOT IN ('CANCELLED', 'EXPIRED')`);
    expect(sql.sql).toContain('uu."blockedAt" IS NULL');
    expect(sql.values).toEqual([['b1'], ['s1'], 'u1']);
  });

  it('adds up spend in one currency when asked, the people and their orders whatever the currency', () => {
    const sql = perCustomerSql({ brandIds: ['b1'], storeIds: null }, undefined, 'MDL');
    expect(sql.sql).toContain(
      'SUM(GREATEST(o."subtotalCents" - o."discountCents", 0)) FILTER (WHERE o."currency" = ?::"Currency")',
    );
    expect(sql.sql).toContain('COUNT(*)::int AS "orders"');
    expect(sql.values).toEqual(['MDL', 'MDL', ['b1']]);
  });
});

function prismaReturning(rows: unknown[]) {
  const queries: Prisma.Sql[] = [];
  const prisma = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Prisma.sql(strings, ...values));
      return Promise.resolve(rows);
    }),
  } as unknown as PrismaService;
  return { prisma, queries };
}

describe('inactiveCustomerIds', () => {
  it('lists the ids the segment query returns', async () => {
    const { prisma, queries } = prismaReturning([{ userId: 'u1' }, { userId: 'u2' }]);
    await expect(inactiveCustomerIds(prisma, { brandIds: ['b1'], storeIds: null }, 14, NOW)).resolves.toEqual([
      'u1',
      'u2',
    ]);
    expect(queries[0]?.values).toEqual([['b1'], 3, '2026-09-26T12:00:00.000Z']);
  });
});

describe('inactiveAtOneStoreOnly', () => {
  it('counts each person once and each store they left, most first', async () => {
    const { prisma } = prismaReturning([
      { userId: 'u1', storeId: 's2', storeName: 'Балка' },
      { userId: 'u1', storeId: 's1', storeName: 'Центр' },
      { userId: 'u2', storeId: 's1', storeName: 'Центр' },
    ]);

    await expect(
      inactiveAtOneStoreOnly(prisma, { brandIds: ['b1'], storeIds: null }, { lastOrderBefore: daysAgo(14) }),
    ).resolves.toEqual({
      count: 2,
      stores: [
        { storeId: 's1', storeName: 'Центр', count: 2 },
        { storeId: 's2', storeName: 'Балка', count: 1 },
      ],
    });
  });

  it('reads a churn period: orders before its end, the last one at the store inside the bounds', async () => {
    const { prisma, queries } = prismaReturning([]);

    await inactiveAtOneStoreOnly(
      prisma,
      { brandIds: ['b1'], storeIds: null },
      { asOf: NOW, lastOrderFrom: daysAgo(21), lastOrderBefore: daysAgo(14) },
    );

    expect(queries[0]?.sql).toContain('o."createdAt" < ?::timestamp');
    expect(queries[0]?.sql).toContain('ps."lastOrderAt" >= ?::timestamp');
    expect(queries[0]?.values).toEqual([
      ['b1'],
      NOW.toISOString(),
      3,
      daysAgo(14).toISOString(),
      daysAgo(21).toISOString(),
      daysAgo(14).toISOString(),
    ]);
  });
});

describe('isInactiveCustomer', () => {
  const scope = { brandIds: ['b1'], storeIds: null };

  it('says yes for a regular who went quiet', async () => {
    const { prisma } = prismaReturning([{ orders: 4, lastOrderAt: daysAgo(20) }]);
    await expect(isInactiveCustomer(prisma, scope, 'u1', 14, NOW)).resolves.toBe(true);
  });

  it('says no for somebody who ordered recently or never', async () => {
    await expect(
      isInactiveCustomer(prismaReturning([{ orders: 4, lastOrderAt: daysAgo(2) }]).prisma, scope, 'u1', 14, NOW),
    ).resolves.toBe(false);
    await expect(isInactiveCustomer(prismaReturning([]).prisma, scope, 'u1', 14, NOW)).resolves.toBe(false);
  });
});
