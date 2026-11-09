import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { KitchenLoadService } from './kitchen-load.service';
import { QueuePolicyService, asapVerdict, basketOf } from './queue-policy.service';
import type { QueueOrderRow } from './queue-state';
import { QueueStateService } from './queue-state.service';

const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-09T12:00:00Z');

/** Open 08:00–20:00 UTC every day. */
const DAYTIME = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: 8 * 60,
  closesAt: 20 * 60,
  isClosed: false,
}));

/** A = 5 min, N = 10 min, one station, open 08:00–20:00 UTC, a shift on. */
const STORE = {
  id: 'store-1',
  status: 'OPEN',
  timezone: 'UTC',
  baseEtaSeconds: 300,
  kitchenParallelism: 1,
  loadExtraSeconds: 600,
  pausedUntil: null as Date | null,
  workingHours: DAYTIME,
  shifts: [{ extendedUntil: null }],
};

function order(patch: Partial<QueueOrderRow> = {}): QueueOrderRow {
  return {
    id: 'order-1',
    userId: 'user-1',
    storeId: 'store-1',
    status: 'ACCEPTED',
    pickupMode: 'ASAP',
    pickupAt: at('2026-11-09T12:10:00Z'),
    readyEstimateAt: null,
    createdAt: at('2026-11-09T11:57:00Z'),
    kitchenVisibleAt: at('2026-11-09T11:57:00Z'),
    acceptedAt: at('2026-11-09T11:58:00Z'),
    startedAt: null,
    placedUnderLoad: false,
    items: [{ quantity: 2, prepSeconds: 300, prepParallel: false, productSnapshot: { id: 'p-latte' } }],
    ...patch,
  };
}

/** Holds a 10-minute reserve for 13:00 (12:50–13:00). */
const PREORDER_AT_ONE = order({
  id: 'preorder',
  status: 'PAID',
  pickupMode: 'SCHEDULED',
  pickupAt: at('2026-11-09T13:00:00Z'),
  acceptedAt: null,
  items: [{ quantity: 1, prepSeconds: 600, prepParallel: false, productSnapshot: { id: 'p-cake' } }],
});

function harness(rows: QueueOrderRow[] = [], store: Partial<typeof STORE> = {}) {
  const prisma = {
    store: {
      findUnique: jest.fn().mockResolvedValue({ ...STORE, ...store }),
      findMany: jest.fn().mockResolvedValue([{ ...STORE, ...store }]),
    },
    order: { findMany: jest.fn().mockResolvedValue(rows) },
    product: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p-americano', prepTimeSeconds: 180, prepParallel: false },
        { id: 'p-cola', prepTimeSeconds: 60, prepParallel: true },
      ]),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
  };
  const kitchen = {
    policy: { maxAsapWaitSeconds: 2700, preorderOpeningLeadSeconds: 15 * 60 },
    typicalPrepByStore: jest.fn().mockResolvedValue(new Map([['store-1', 240]])),
    slotLoadByStore: jest
      .fn()
      .mockResolvedValue(
        new Map([['store-1', new Map([[ms('2026-11-09T13:00:00Z'), { count: 1, workSeconds: 600 }]])]]),
      ),
  };
  const states = new QueueStateService(prisma as unknown as PrismaService);
  const service = new QueuePolicyService(
    prisma as unknown as PrismaService,
    states,
    kitchen as unknown as KitchenLoadService,
    { queuePolicyEnabled: true } as FeatureFlagsService,
  );
  return { service, prisma, kitchen };
}

const TWO_AMERICANOS = [{ prepSeconds: 180, quantity: 2 }];

describe('QueuePolicyService — the cart quote (2.5)', () => {
  it('says when the cart would be ready if ordered now: R = T + A, then its positions', async () => {
    const { service } = harness();
    const quote = await service.quoteBasket('store-1', TWO_AMERICANOS, NOW);
    // «Если закажете сейчас — будет готово в 12:11 · ≈ 11 мин»
    expect(quote.readyAt).toEqual(at('2026-11-09T12:11:00Z'));
    expect(quote.etaSeconds).toBe(660);
    expect(quote.quote).toMatchObject({ available: true, reason: null, waitMinutes: 11, position: 1 });
  });

  it('queues the cart behind the orders already taken (FIFO, one station)', async () => {
    const { service } = harness([order()]);
    const quote = await service.quoteBasket('store-1', TWO_AMERICANOS, NOW);
    // The accepted order runs 12:00–12:10; ours 12:10–12:16.
    expect(quote.readyAt).toEqual(at('2026-11-09T12:16:00Z'));
    expect(quote.quote.position).toBe(2);
  });

  it('adds N to A while «Загрузка» is on', async () => {
    const { service } = harness([], { status: 'OVERLOADED' });
    const quote = await service.quoteBasket('store-1', TWO_AMERICANOS, NOW);
    expect(quote.readyAt).toEqual(at('2026-11-09T12:21:00Z'));
  });

  it('runs a parallel position alongside the rest', async () => {
    const { service } = harness();
    const quote = await service.quoteBasket(
      'store-1',
      [
        { prepSeconds: 180, quantity: 1 },
        { prepSeconds: 60, parallel: true, quantity: 1 },
      ],
      NOW,
    );
    expect(quote.readyAt).toEqual(at('2026-11-09T12:08:00Z'));
  });

  it("is not available after the closing, and tells «Перерыв» by the calculator's own reason", async () => {
    const evening = at('2026-11-09T19:50:00Z');
    const { service } = harness();
    expect((await service.quoteBasket('store-1', TWO_AMERICANOS, evening)).quote.reason).toBe('CLOSING_SOON');

    const paused = harness([], { pausedUntil: at('2026-11-09T12:30:00Z') });
    expect((await paused.service.quoteBasket('store-1', TWO_AMERICANOS, NOW)).quote.reason).toBe('PAUSED');
  });

  it("quotes every store's «N мин» for one position of its typical time", async () => {
    const { service, kitchen } = harness();
    const quotes = await service.typicalQuotes([STORE], NOW);
    expect(kitchen.typicalPrepByStore).toHaveBeenCalledWith(['store-1'], NOW);
    expect(quotes.get('store-1')?.readyAt).toBe(ms('2026-11-09T12:09:00Z'));
  });

  it('reads B and the flag of cart lines off the products, the options left out', async () => {
    const { service } = harness();
    expect(
      await service.basket([
        { productId: 'p-americano', quantity: 2 },
        { productId: 'p-cola', quantity: 1 },
      ]),
    ).toEqual([
      { prepSeconds: 180, parallel: false, quantity: 2 },
      { prepSeconds: 60, parallel: true, quantity: 1 },
    ]);
    expect(basketOf([{ productId: 'p-unknown', quantity: 1 }], new Map())).toEqual([
      { prepSeconds: 0, parallel: false, quantity: 1 },
    ]);
  });
});

describe('the ASAP verdict', () => {
  const open = { openNow: true, asapBlockedReason: null, closesAt: at('2026-11-09T20:00:00Z'), extendedUntil: null };
  const t = NOW.getTime();

  it("takes the store's own reason first", () => {
    expect(asapVerdict({ ...open, openNow: false, asapBlockedReason: 'PAUSED' }, t, t, 2700)).toEqual({
      available: false,
      reason: 'PAUSED',
    });
  });

  it('refuses a cart ready after the closing (or the extension) and one past the longest wait', () => {
    const evening = ms('2026-11-09T19:50:00Z');
    expect(asapVerdict(open, ms('2026-11-09T20:01:00Z'), evening, 2700).reason).toBe('CLOSING_SOON');
    const extended = { ...open, extendedUntil: at('2026-11-09T20:30:00Z') };
    expect(asapVerdict(extended, ms('2026-11-09T20:01:00Z'), evening, 2700).available).toBe(true);
    expect(asapVerdict(open, ms('2026-11-09T12:46:00Z'), t, 2700).reason).toBe('QUEUE_FULL');
    expect(asapVerdict(open, ms('2026-11-09T12:45:00Z'), t, 2700)).toEqual({ available: true, reason: null });
  });
});

describe('QueuePolicyService — pre-orders (2.4)', () => {
  const ONE_LATTE = [{ prepSeconds: 300, quantity: 1 }];

  it("offers the free runs of minutes: not sooner than t + A + B, around the other pre-orders' reserves", async () => {
    const { service } = harness([PREORDER_AT_ONE]);
    const windows = await service.readyWindows('store-1', ONE_LATTE, NOW);
    expect(windows.slice(0, 3)).toEqual([
      { from: ms('2026-11-09T12:10:00Z'), to: ms('2026-11-09T12:50:00Z') },
      { from: ms('2026-11-09T13:05:00Z'), to: ms('2026-11-09T20:00:00Z') },
      // Tomorrow: the opening lead of 15 minutes, then the cooking.
      { from: ms('2026-11-10T08:20:00Z'), to: ms('2026-11-10T12:00:00Z') },
    ]);
  });

  it('opens pre-orders again after «Перерыв» for baskets cooked after it', async () => {
    const { service } = harness([], { pausedUntil: at('2026-11-09T12:30:00Z') });
    const [first] = await service.readyWindows('store-1', ONE_LATTE, NOW);
    expect(first?.from).toBe(ms('2026-11-09T12:35:00Z'));
  });

  it('keeps the 15-minute slots for old app builds: closed times left out, the reserve struck out', async () => {
    const { service } = harness([PREORDER_AT_ONE]);
    const slots = await service.pickupSlots('store-1', ONE_LATTE, NOW);
    expect(slots[0]).toEqual({
      startsAt: at('2026-11-09T12:15:00Z'),
      endsAt: at('2026-11-09T12:30:00Z'),
      taken: 0,
      available: true,
    });
    expect(slots.find((s) => s.startsAt.getTime() === ms('2026-11-09T13:00:00Z'))).toMatchObject({
      taken: 1,
      available: false,
    });
    expect(slots.some((s) => s.startsAt.getTime() === ms('2026-11-09T21:00:00Z'))).toBe(false);
  });

  it('books a free time and refuses a taken one, a too early one, a closed one and one past 24 hours', async () => {
    const { service } = harness([PREORDER_AT_ONE]);
    await expect(service.assertPreorderTime('store-1', ONE_LATTE, at('2026-11-09T13:30:00Z'), NOW)).resolves.toBe(
      undefined,
    );
    await expect(
      service.assertPreorderTime('store-1', ONE_LATTE, at('2026-11-09T12:55:00Z'), NOW),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PICKUP_SLOT_FULL' }) });
    await expect(
      service.assertPreorderTime('store-1', ONE_LATTE, at('2026-11-09T12:07:00Z'), NOW),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKUP_TIME_OUT_OF_RANGE', minMinutes: 10, maxHours: 24 }),
    });
    await expect(
      service.assertPreorderTime('store-1', ONE_LATTE, at('2026-11-09T21:00:00Z'), NOW),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORE_CLOSED_AT_TIME' }) });
    await expect(
      service.assertPreorderTime('store-1', ONE_LATTE, at('2026-11-10T12:01:00Z'), NOW),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PICKUP_TIME_OUT_OF_RANGE' }) });
  });

  it('refuses a time inside «Перерыв» as closed', async () => {
    const { service } = harness([], { pausedUntil: at('2026-11-09T12:30:00Z') });
    await expect(
      service.assertPreorderTime('store-1', ONE_LATTE, at('2026-11-09T12:25:00Z'), NOW),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORE_CLOSED_AT_TIME' }) });
  });

  it('reads the queue through the transaction it is given', async () => {
    const { service, prisma } = harness();
    const tx = {
      store: { findUnique: jest.fn().mockResolvedValue(STORE) },
      order: { findMany: jest.fn().mockResolvedValue([PREORDER_AT_ONE]) },
      product: { findMany: jest.fn() },
    };
    await expect(
      service.assertPreorderTime('store-1', ONE_LATTE, at('2026-11-09T12:55:00Z'), NOW, tx as never),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PICKUP_SLOT_FULL' }) });
    expect(tx.order.findMany).toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("takes the store's advisory lock for the rest of the transaction", async () => {
    const { service, prisma } = harness();
    await service.lockStore(prisma as never, 'store-1');
    const [sql, key] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('pg_advisory_xact_lock(hashtext(?))');
    expect(key).toBe('queue-policy:store-1');
  });
});

describe('QueuePolicyService — the kitchen board (2.4)', () => {
  it('gives every order its start O and ready time G', async () => {
    const { service } = harness([order(), PREORDER_AT_ONE]);
    const plans = await service.plans(['store-1'], NOW);
    expect(plans.get('order-1')).toEqual({ startAt: ms('2026-11-09T12:00:00Z'), readyAt: ms('2026-11-09T12:10:00Z') });
    expect(plans.get('preorder')).toEqual({ startAt: ms('2026-11-09T12:50:00Z'), readyAt: ms('2026-11-09T13:00:00Z') });
  });

  it('lays a started order out from its start', async () => {
    const started = order({ status: 'IN_PROGRESS', startedAt: at('2026-11-09T11:59:00Z') });
    const { service } = harness([started]);
    const plans = await service.plans(['store-1'], NOW);
    expect(plans.get('order-1')).toEqual({ startAt: ms('2026-11-09T11:59:00Z'), readyAt: ms('2026-11-09T12:09:00Z') });
  });
});
