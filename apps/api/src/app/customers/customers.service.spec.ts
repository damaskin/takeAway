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

  it('narrows to the inactive segment: 3+ orders and none for the chosen days', async () => {
    const { svc, queries } = service([[]]);
    await svc.list(scope, { segment: 'inactive', inactiveDays: 7 }, NOW);
    expect(queries[0]?.sql).toContain('p."lastOrderAt" <');
    expect(queries[0]?.values).toEqual(expect.arrayContaining([3, '2026-09-27T12:00:00.000Z']));
  });

  it('keeps everyone without a segment', async () => {
    const { svc, queries } = service([[]]);
    await svc.list(scope, {}, NOW);
    expect(queries[0]?.sql).not.toContain('p."orders" >=');
  });

  it('names the product a customer keeps ordering', async () => {
    const { svc } = service([
      [row],
      [{ userId: 'u1', storeId: 's1', storeName: 'Center' }],
      [
        { userId: 'u1', name: 'Латте', quantity: 7, categoryName: 'Кофе', caffeineLevel: null, drinkOptions: false },
        {
          userId: 'u1',
          name: 'Круассан',
          quantity: 5,
          categoryName: 'Выпечка',
          caffeineLevel: null,
          drinkOptions: false,
        },
      ],
    ]);
    const page = await svc.list(scope, {}, NOW);
    expect(page.items[0]?.favouriteProduct).toEqual({ name: 'Латте', quantity: 7, kind: 'DRINK' });
  });

  it('counts people over every store, and their spend in the currency picked when stores price in several', async () => {
    const { svc, queries } = service([
      [{ ...row, orders: 5, moneyOrders: 2, totalCents: 9_000n }],
      [{ userId: 'u1', storeId: 's1', storeName: 'Center' }],
    ]);
    const page = await svc.list(scope, {}, NOW, { currency: 'RUP', currencies: ['MDL', 'RUP'] });

    expect(queries[0]?.sql).toContain('FILTER (WHERE o."currency" = ?::"Currency")');
    expect(queries[0]?.values).toContain('RUP');
    // Five orders in all, two of them in roubles: the check is over those two.
    expect(page.items[0]).toEqual(expect.objectContaining({ orders: 5, totalCents: 9_000, avgCheckCents: 4_500 }));
    expect(page).toEqual(expect.objectContaining({ currency: 'RUP', currencies: ['MDL', 'RUP'] }));
  });

  it('adds every order up when the stores price in one currency', async () => {
    const { svc, queries } = service([[]]);
    const page = await svc.list(scope, {}, NOW, { currency: 'RUP', currencies: ['RUP'] });

    expect(queries[0]?.sql).not.toContain('"currency" =');
    expect(page).toEqual(expect.objectContaining({ currency: 'RUP', currencies: ['RUP'], activeElsewhere: null }));
  });

  it('on the brand-wide inactive list, counts who went quiet at one store but orders at another', async () => {
    const { svc, queries } = service([
      [],
      [
        { userId: 'u2', storeId: 's2', storeName: 'Балка' },
        { userId: 'u3', storeId: 's1', storeName: 'Центр' },
        { userId: 'u4', storeId: 's1', storeName: 'Центр' },
      ],
    ]);
    const page = await svc.list(scope, { segment: 'inactive', inactiveDays: 7 }, NOW);

    expect(page.activeElsewhere).toEqual({
      count: 3,
      stores: [
        { storeId: 's1', storeName: 'Центр', count: 2 },
        { storeId: 's2', storeName: 'Балка', count: 1 },
      ],
    });
    // Inactive at the store (3+ orders there, none for 7 days), active across the stores.
    expect(queries[1]?.sql).toContain('ps."orders" >= ?');
    expect(queries[1]?.sql).toContain('ps."lastOrderAt" < ?');
    expect(queries[1]?.sql).toContain('pu."lastOrderAt" >= ?');
    expect(queries[1]?.values).toEqual(expect.arrayContaining([3, '2026-09-27T12:00:00.000Z']));
  });

  it('has nothing to add about other stores once a store is picked', async () => {
    const { svc, queries } = service([[]]);
    const page = await svc.list(
      { brandIds: ['b1'], storeIds: ['s1'] },
      { segment: 'inactive', inactiveDays: 7, storeId: 's1' },
      NOW,
    );

    expect(page.activeElsewhere).toBeNull();
    expect(queries).toHaveLength(1);
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

  it('lists every favourite, drinks and food told apart', async () => {
    const { svc, queries } = service([
      [row],
      [],
      [
        { userId: 'u1', name: 'Латте', quantity: 12, categoryName: 'Кофе', caffeineLevel: 2, drinkOptions: true },
        {
          userId: 'u1',
          name: 'Сырники',
          quantity: 6,
          categoryName: 'Завтраки',
          caffeineLevel: null,
          drinkOptions: false,
        },
        { userId: 'u1', name: 'Сет', quantity: 5, categoryName: null, caffeineLevel: null, drinkOptions: false },
      ],
      [{ userId: 'u1', storeId: 's1', storeName: 'Center' }],
    ]);
    const detail = await svc.detail(scope, 'u1', NOW);
    expect(detail.favourites).toEqual([
      { name: 'Латте', quantity: 12, kind: 'DRINK' },
      { name: 'Сырники', quantity: 6, kind: 'FOOD' },
      { name: 'Сет', quantity: 5, kind: null },
    ]);
    expect(detail.favouriteProduct).toEqual({ name: 'Латте', quantity: 12, kind: 'DRINK' });
    // Counted by units over counted orders, from 5 up.
    expect(queries[2]?.sql).toContain('HAVING SUM(oi."quantity") >= ?');
    expect(queries[2]?.values).toContain(5);
    expect(queries).toHaveLength(4);
  });

  it("shows each store's spend in the store's own currency when the stores price in several", async () => {
    const { svc, queries } = service([
      [{ ...row, orders: 4, moneyOrders: 3 }],
      [
        { storeId: 's1', storeName: 'Center', currency: 'RUP', orders: 3, totalCents: 9_000n },
        { storeId: 'm1', storeName: 'Moldova', currency: 'MDL', orders: 1, totalCents: 500n },
      ],
      [],
      [{ userId: 'u1', storeId: 's1', storeName: 'Center' }],
    ]);
    const detail = await svc.detail(scope, 'u1', NOW, { currency: 'RUP', currencies: ['MDL', 'RUP'] });

    expect(queries[1]?.sql).toContain('o."currency" = s."currency"');
    expect(detail.currency).toBe('RUP');
    expect(detail.avgCheckCents).toBe(3_000);
    expect(detail.stores).toEqual([
      { storeId: 's1', storeName: 'Center', currency: 'RUP', orders: 3, totalCents: 9_000 },
      { storeId: 'm1', storeName: 'Moldova', currency: 'MDL', orders: 1, totalCents: 500 },
    ]);
  });

  it('knows nobody who never ordered from the brand', async () => {
    const { svc } = service([[], [], []]);
    await expect(svc.detail(scope, 'u1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});
