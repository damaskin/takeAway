import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from './customers.service';

const NOW = new Date('2026-10-04T12:00:00Z');
const scope = { brandIds: ['b1'], storeIds: null };

function service(rows: unknown[][], user: unknown = { id: 'u1', email: 'u@x', blockedAt: null }) {
  const queries: Prisma.Sql[] = [];
  let call = 0;
  const prisma = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(Prisma.sql(strings, ...values));
      return Promise.resolve(rows[call++] ?? []);
    }),
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findMany: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Ира', phone: null }]),
    },
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
  return { svc: new CustomersService(prisma), queries };
}

const row = {
  userId: 'u1',
  orders: 3,
  totalCents: 9_000n,
  firstOrderAt: new Date('2026-09-01T09:00:00Z'),
  lastOrderAt: new Date('2026-09-21T09:00:00Z'),
  total: 1,
};

describe('CustomersService.list', () => {
  it('works out check, frequency, recency and the favourite store', async () => {
    const { svc } = service([[row], [{ userId: 'u1', storeId: 's1', storeName: 'Center' }]]);
    const page = await svc.list(scope, {}, NOW);
    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        name: 'Ира',
        avgCheckCents: 3_000,
        avgDaysBetweenOrders: 10,
        daysSinceLastOrder: 13,
        favouriteStoreName: 'Center',
      }),
    );
  });

  it('searches with the wildcards of the query escaped', async () => {
    const { svc, queries } = service([[]]);
    await svc.list(scope, { search: '50%_off' }, NOW);
    expect(queries[0]?.values).toContain('%50\\%\\_off%');
  });

  it('leaves deleted accounts out', async () => {
    const { svc, queries } = service([[]]);
    await svc.list(scope, {}, NOW);
    expect(queries[0]?.sql).toContain('uu."blockedAt" IS NULL');
  });

  it('sorts the most frequent customers first by default for frequency', async () => {
    const { svc, queries } = service([[]]);
    await svc.list(scope, { sort: 'frequency' }, NOW);
    expect(queries[0]?.sql).toMatch(/\/ \(p\."orders" - 1\) END ASC NULLS LAST/);
  });
});

describe('CustomersService.detail', () => {
  it('hides a deleted account', async () => {
    const { svc } = service([], { id: 'u1', email: null, blockedAt: new Date() });
    await expect(svc.detail(scope, 'u1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('knows nobody who never ordered from the brand', async () => {
    const { svc } = service([[], [], []]);
    await expect(svc.detail(scope, 'u1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});
