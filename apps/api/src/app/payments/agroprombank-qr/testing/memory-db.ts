import type { Payment } from '@prisma/client';

/**
 * Just enough of Prisma for the QR service, its holds and its cron: the
 * payment, order and order-event rows, with the `where` shapes those
 * actually use (equality, `in`, `not`, `lt`, `OR`, and the `order` relation).
 * Not a general fake. Tests only.
 */

export type MemoryOrder = {
  id: string;
  userId: string;
  status: string;
  totalCents: number;
  currency: string;
  orderCode: string;
  cancelMoney: string | null;
};

type Where = Record<string, unknown>;

/** One numbering across a test file, like the real sequence. */
let seq = 100_000;

export function createMemoryDb() {
  const payments = new Map<string, Payment>();
  const orders = new Map<string, MemoryOrder>();
  const events: Array<{ orderId: string; type: string; payload: Record<string, unknown> }> = [];
  let ids = 0;

  const matches = (row: Record<string, unknown>, where: Where = {}): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') return (cond as Where[]).some((branch) => matches(row, branch));
      if (key === 'order') {
        const order = orders.get(String(row['orderId']));
        return !!order && matches(order, cond as Where);
      }
      const value = row[key];
      if (cond === null) return value === null || value === undefined;
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as Record<string, unknown>;
        if ('path' in c && 'equals' in c) {
          const json = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
          return json[(c['path'] as string[])[0] ?? ''] === c['equals'];
        }
        if ('in' in c) return (c['in'] as unknown[]).includes(value);
        if ('not' in c) return value !== c['not'];
        if ('lt' in c) return (value as Date) < (c['lt'] as Date);
        return true;
      }
      return value === cond;
    });
  const newest = (rows: Payment[]): Payment[] => [...rows].sort((a, b) => +b.createdAt - +a.createdAt);
  const withOrder = (row: Payment, include?: Where) =>
    include?.['order'] ? { ...row, order: { ...(orders.get(row.orderId) as MemoryOrder) } } : row;

  const prisma = {
    payment: {
      findFirst: async ({ where }: { where: Where }) =>
        newest([...payments.values()].filter((p) => matches(p, where)))[0] ?? null,
      findMany: async ({ where, include }: { where: Where; include?: Where }) =>
        newest([...payments.values()].filter((p) => matches(p, where))).map((p) => withOrder(p, include)),
      findUnique: async ({ where }: { where: { id?: string; invoiceId?: string } }) =>
        [...payments.values()].find((p) => (where.id ? p.id === where.id : p.invoiceId === where.invoiceId)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = payments.get(where.id);
        if (!row) throw new Error('not found');
        return row;
      },
      create: async ({ data }: { data: Partial<Payment> }) => {
        ids += 1;
        if (data.invoiceId && [...payments.values()].some((p) => p.invoiceId === data.invoiceId)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row = {
          id: `pay-${ids}`,
          providerRef: null,
          tipCents: 0,
          refundedCents: 0,
          cardTokenId: null,
          rawJson: null,
          // Strictly increasing, and just in the past, so "older than now" finds it.
          createdAt: new Date(Date.now() - 1_000 + ids),
          updatedAt: new Date(),
          ...data,
        } as Payment;
        payments.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Payment> }) => {
        const row = { ...(payments.get(where.id) as Payment), ...data, updatedAt: new Date() };
        payments.set(row.id, row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Where; data: Partial<Payment> }) => {
        let count = 0;
        for (const row of payments.values()) {
          if (!matches(row, where)) continue;
          payments.set(row.id, { ...row, ...data, updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
    },
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => orders.get(where.id) ?? null,
      updateMany: async ({ where, data }: { where: Where; data: Partial<MemoryOrder> }) => {
        let count = 0;
        for (const row of orders.values()) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    orderEvent: {
      create: async ({ data }: { data: { orderId: string; type: string; payload: Record<string, unknown> } }) =>
        events.push(data),
    },
    $queryRaw: async () => [{ value: BigInt((seq += 1)) }],
  };

  /** A new unpaid order in рубли ПМР. */
  function addOrder(id: string, totalCents: number, overrides: Partial<MemoryOrder> = {}): MemoryOrder {
    const order: MemoryOrder = {
      id,
      userId: 'user-1',
      status: 'CREATED',
      totalCents,
      currency: 'RUP',
      orderCode: id,
      cancelMoney: null,
      ...overrides,
    };
    orders.set(id, order);
    return order;
  }

  return { prisma, payments, orders, events, addOrder };
}
