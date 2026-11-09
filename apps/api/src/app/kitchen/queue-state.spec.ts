import {
  type QueueOrderRow,
  type QueueStoreFacts,
  buildQueueState,
  mergeRanges,
  preorderState,
  productIdsToLookUp,
  queueHours,
  queueOrdersWhere,
  queueSettings,
  toQueueOrder,
} from './queue-state';

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

function store(patch: Partial<QueueStoreFacts> = {}): QueueStoreFacts {
  return {
    id: 'store-1',
    status: 'OPEN',
    timezone: 'UTC',
    baseEtaSeconds: 300,
    kitchenParallelism: 2,
    loadExtraSeconds: 600,
    workingHours: DAYTIME,
    shifts: [{ extendedUntil: null }],
    pausedUntil: null,
    ...patch,
  };
}

function row(patch: Partial<QueueOrderRow> = {}): QueueOrderRow {
  return {
    id: 'order-1',
    userId: 'user-1',
    storeId: 'store-1',
    status: 'PAID',
    pickupMode: 'ASAP',
    pickupAt: at('2026-11-09T12:10:00Z'),
    readyEstimateAt: null,
    createdAt: at('2026-11-09T11:55:00Z'),
    kitchenVisibleAt: at('2026-11-09T11:56:00Z'),
    acceptedAt: null,
    startedAt: null,
    placedUnderLoad: false,
    items: [{ quantity: 2, prepSeconds: 180, prepParallel: false, productSnapshot: { id: 'p-americano' } }],
    ...patch,
  };
}

describe('the queue state from database rows (docs/queue-policy.md 2.2)', () => {
  it('takes T from when the order reached the kitchen, and the positions snapshotted on its lines', () => {
    expect(toQueueOrder(row(), 3, new Map())).toEqual({
      id: 'order-1',
      placedAt: ms('2026-11-09T11:56:00Z'),
      seq: 3,
      placedUnderLoad: false,
      acceptedAt: null,
      startedAt: null,
      readyBy: null,
      items: [{ prepSeconds: 180, parallel: false, quantity: 2 }],
    });
  });

  it('falls back to the creation for orders from before kitchenVisibleAt existed', () => {
    expect(toQueueOrder(row({ kitchenVisibleAt: null }), 0, new Map()).placedAt).toBe(ms('2026-11-09T11:55:00Z'));
  });

  it('makes a pre-order a reserve ready at its pickup time, and keeps «Принял» and «Начать»', () => {
    const scheduled = toQueueOrder(
      row({
        pickupMode: 'SCHEDULED',
        pickupAt: at('2026-11-09T13:00:00Z'),
        status: 'IN_PROGRESS',
        acceptedAt: at('2026-11-09T11:58:00Z'),
        startedAt: at('2026-11-09T11:59:00Z'),
        placedUnderLoad: true,
      }),
      0,
      new Map(),
    );
    expect(scheduled).toMatchObject({
      readyBy: ms('2026-11-09T13:00:00Z'),
      acceptedAt: ms('2026-11-09T11:58:00Z'),
      startedAt: ms('2026-11-09T11:59:00Z'),
      placedUnderLoad: true,
    });
  });

  it('counts an order in progress with no start on record as started when it was accepted', () => {
    const order = toQueueOrder(
      row({ status: 'IN_PROGRESS', acceptedAt: at('2026-11-09T11:58:00Z'), startedAt: null }),
      0,
      new Map(),
    );
    expect(order.startedAt).toBe(ms('2026-11-09T11:58:00Z'));
  });

  it('reads the product as it is now for lines placed before B was snapshotted, else the line itself', () => {
    const old = row({
      items: [
        { quantity: 1, prepSeconds: null, prepParallel: null, productSnapshot: { id: 'p-cola', unitPrepSeconds: 200 } },
        { quantity: 1, prepSeconds: null, prepParallel: null, productSnapshot: { id: 'p-gone', unitPrepSeconds: 240 } },
      ],
    });
    expect(productIdsToLookUp([old, row()])).toEqual(['p-cola', 'p-gone']);
    const products = new Map([['p-cola', { prepTimeSeconds: 30, prepParallel: true }]]);
    expect(toQueueOrder(old, 0, products).items).toEqual([
      { prepSeconds: 30, parallel: true, quantity: 1 },
      { prepSeconds: 240, parallel: false, quantity: 1 },
    ]);
  });

  it("builds the store's state: A, N and C, its own orders by creation, «Загрузка» and «Перерыв»", () => {
    const state = buildQueueState(
      store({ status: 'OVERLOADED', baseEtaSeconds: 0, pausedUntil: at('2026-11-09T12:30:00Z') }),
      [
        row({ id: 'second', createdAt: at('2026-11-09T11:57:00Z') }),
        row({ id: 'elsewhere', storeId: 'store-2' }),
        row({ id: 'first', createdAt: at('2026-11-09T11:50:00Z') }),
      ],
      new Map(),
      NOW,
    );
    // A below a minute counts as the default 10 minutes, as for the accept reminder.
    expect(state.settings).toEqual({ acceptSeconds: 600, loadExtraSeconds: 600, stations: 2 });
    expect(state.orders.map((o) => [o.id, o.seq])).toEqual([
      ['first', 0],
      ['second', 1],
    ]);
    expect(state.loadOn).toBe(true);
    expect(state.paused).toBe(true);
    expect(buildQueueState(store({ pausedUntil: at('2026-11-09T11:00:00Z') }), [], new Map(), NOW).paused).toBe(false);
  });

  it('defaults N to 10 minutes and C to at least one station', () => {
    expect(queueSettings(store({ loadExtraSeconds: undefined, kitchenParallelism: 0 }))).toEqual({
      acceptSeconds: 300,
      loadExtraSeconds: 600,
      stations: 1,
    });
  });

  it('asks the database for the orders that still owe work, unpaid pre-orders included, forgotten ones not', () => {
    expect(queueOrdersWhere(['store-1'], NOW)).toEqual({
      storeId: { in: ['store-1'] },
      status: { in: ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS'] },
      AND: [
        { OR: [{ kitchenVisibleAt: { not: null } }, { status: { not: 'CREATED' } }, { pickupMode: 'SCHEDULED' }] },
        {
          OR: [
            { pickupAt: { gte: at('2026-11-09T10:00:00Z') } },
            { readyEstimateAt: { gte: at('2026-11-09T10:00:00Z') } },
          ],
        },
      ],
    });
  });
});

describe('the hours the calculator sees', () => {
  it('is null for a store open around the clock', () => {
    expect(queueHours(store({ workingHours: [] }), NOW)).toBeNull();
  });

  it('lists the windows from a day back to two ahead', () => {
    const hours = queueHours(store(), NOW);
    expect(hours).toContainEqual({ from: ms('2026-11-09T08:00:00Z'), to: ms('2026-11-09T20:00:00Z') });
    expect(hours).toContainEqual({ from: ms('2026-11-10T08:00:00Z'), to: ms('2026-11-10T20:00:00Z') });
  });

  it('stretches the window open now to the extension of the closing', () => {
    const evening = at('2026-11-09T19:50:00Z');
    const hours = queueHours(store({ shifts: [{ extendedUntil: at('2026-11-09T20:30:00Z') }] }), evening);
    expect(hours).toContainEqual({ from: ms('2026-11-09T08:00:00Z'), to: ms('2026-11-09T20:30:00Z') });
  });

  it('stretches the window that closed last while an extension runs past it', () => {
    const late = at('2026-11-09T20:10:00Z');
    const hours = queueHours(store({ shifts: [{ extendedUntil: at('2026-11-09T21:00:00Z') }] }), late);
    expect(hours).toContainEqual({ from: ms('2026-11-09T08:00:00Z'), to: ms('2026-11-09T21:00:00Z') });
  });

  it('joins overlapping ranges', () => {
    expect(
      mergeRanges([
        { from: 5, to: 9 },
        { from: 0, to: 5 },
        { from: 12, to: 14 },
      ]),
    ).toEqual([
      { from: 0, to: 9 },
      { from: 12, to: 14 },
    ]);
  });
});

describe('the state for pre-orders (decisions of 2.7)', () => {
  const lead = 15 * 60;

  it('starts a window that has not opened yet 15 minutes later, and the one open now only with nobody on shift', () => {
    const state = buildQueueState(store(), [], new Map(), NOW);
    const open = preorderState(state, store(), NOW, lead).hours;
    expect(open).toContainEqual({ from: ms('2026-11-09T08:00:00Z'), to: ms('2026-11-09T20:00:00Z') });
    expect(open).toContainEqual({ from: ms('2026-11-10T08:15:00Z'), to: ms('2026-11-10T20:00:00Z') });

    const closedShift = preorderState(state, store({ shifts: [] }), NOW, lead).hours;
    expect(closedShift).toContainEqual({ from: ms('2026-11-09T08:15:00Z'), to: ms('2026-11-09T20:00:00Z') });
  });

  it('makes «Перерыв» a gap in the hours instead of closing pre-orders', () => {
    const paused = store({ pausedUntil: at('2026-11-09T12:30:00Z') });
    const state = buildQueueState(paused, [], new Map(), NOW);
    expect(state.paused).toBe(true);
    const pre = preorderState(state, paused, NOW, lead);
    expect(pre.paused).toBe(false);
    expect(pre.hours).toContainEqual({ from: ms('2026-11-09T12:30:00Z'), to: ms('2026-11-09T20:00:00Z') });
    expect(pre.hours?.some((w) => w.to <= ms('2026-11-09T12:30:00Z'))).toBe(false);
  });

  it('gives a store open around the clock hours from the end of its pause', () => {
    const paused = store({ workingHours: [], pausedUntil: at('2026-11-09T12:30:00Z') });
    const pre = preorderState(buildQueueState(paused, [], new Map(), NOW), paused, NOW, lead);
    expect(pre.hours?.[0]?.from).toBe(ms('2026-11-09T12:30:00Z'));
    expect(
      preorderState(buildQueueState(store({ workingHours: [] }), [], new Map(), NOW), store(), NOW, lead).hours,
    ).toBeNull();
  });
});
