import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { QueueState } from '@takeaway/utils';

import { PrismaService } from '../prisma/prisma.service';
import {
  QUEUE_ORDER_SELECT,
  QUEUE_STORE_SELECT,
  type QueueOrderRow,
  type QueueProductFacts,
  type QueueStoreFacts,
  buildQueueState,
  productIdsToLookUp,
  queueOrdersWhere,
} from './queue-state';

/** The Prisma client or an interactive transaction: the booking check reads inside its lock. */
export type QueueDb = Pick<Prisma.TransactionClient, 'order' | 'product' | 'store'>;

/** A store's queue as read now: the facts it was built from, the order rows and the calculator's state. */
export interface LoadedQueue<S extends QueueStoreFacts = QueueStoreFacts> {
  store: S;
  rows: QueueOrderRow[];
  state: QueueState;
}

/**
 * Reads what the queue calculator needs (docs/queue-policy.md 2.2): the
 * orders that still owe the kitchen work — one query for any number of
 * stores — and, for lines placed before their B was snapshotted, the
 * products as they are now. The mapping itself is queue-state.ts.
 */
@Injectable()
export class QueueStateService {
  constructor(private readonly prisma: PrismaService) {}

  /** The queues of stores the caller already has (the store lists, availability). */
  async load<S extends QueueStoreFacts>(
    stores: readonly S[],
    now: Date,
    db: QueueDb = this.prisma,
  ): Promise<Map<string, LoadedQueue<S>>> {
    const result = new Map<string, LoadedQueue<S>>();
    if (stores.length === 0) return result;
    const rows = await db.order.findMany({
      where: queueOrdersWhere(
        stores.map((s) => s.id),
        now,
      ),
      select: QUEUE_ORDER_SELECT,
    });
    const products = await this.productsOf(rows, db);
    for (const store of stores) {
      const own = rows.filter((row) => row.storeId === store.id);
      result.set(store.id, { store, rows: own, state: buildQueueState(store, own, products, now) });
    }
    return result;
  }

  /** One store's queue, the store read too. */
  async loadOne(storeId: string, now: Date, db: QueueDb = this.prisma): Promise<LoadedQueue> {
    const store = await db.store.findUnique({ where: { id: storeId }, select: QUEUE_STORE_SELECT });
    if (!store) throw new NotFoundException('Store not found');
    const loaded = (await this.load([store], now, db)).get(store.id);
    if (!loaded) throw new NotFoundException('Store not found');
    return loaded;
  }

  private async productsOf(rows: readonly QueueOrderRow[], db: QueueDb): Promise<Map<string, QueueProductFacts>> {
    const ids = productIdsToLookUp(rows);
    if (ids.length === 0) return new Map();
    const products = await db.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, prepTimeSeconds: true, prepParallel: true },
    });
    return new Map(products.map((p) => [p.id, { prepTimeSeconds: p.prepTimeSeconds, prepParallel: p.prepParallel }]));
  }
}
