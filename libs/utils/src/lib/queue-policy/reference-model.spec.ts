import { preorderWindows, scheduleQueue } from './queue-policy';
import type { QueueItem, QueueOrder, QueueState } from './types';

/**
 * The 22 checks of the manager's reference model («queue_model (эталонная
 * модель для автотестов прием и выдача заказов).py»), ported one to one:
 * same inputs, same expected strings, each test named after its check.
 * Times are minutes after 12:00, as in the model; the harness below turns
 * the model's arguments into calculator input.
 */

const NOON = Date.UTC(2026, 10, 6, 12, 0);
const MINUTE = 60_000;
const m = (minutes: number): number => NOON + minutes * MINUTE;

/** The model's `hhmm`: "12:06", with "+0.50" for a fraction of a minute. */
function hhmm(at: number): string {
  const minutes = Math.round(((at - NOON) / MINUTE) * 10_000) / 10_000;
  const whole = Math.trunc(minutes);
  const text = `${String(12 + Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  return minutes === whole ? text : `${text}+${(minutes - whole).toFixed(2)}`;
}

/** The model's item: (B in minutes, parallel). */
type ModelItem = readonly [number, boolean];

interface ModelOrder {
  T: number;
  L?: 0 | 1;
  accepted?: number;
  items: readonly ModelItem[];
}

const AM: ModelItem = [1, false];
const CAP: ModelItem = [3, false];
const LAT: ModelItem = [2, false];
const BURG: ModelItem = [6, false];
const FRIES: ModelItem = [4, true];
const COLA: ModelItem = [1, true];

const toItems = (items: readonly ModelItem[]): QueueItem[] =>
  items.map(([minutes, parallel]) => ({ prepSeconds: minutes * 60, parallel }));

/**
 * The model's `schedule(orders, C, A, N, t, reserves, started)`, returning
 * G of each order as "HH:MM". `started` items are (station, S_fact, B); the
 * model pins them to a station, the calculator lays a started order out on
 * the first free one — the same here, where every check has one on station 0.
 */
function schedule(
  orders: readonly ModelOrder[],
  {
    C,
    A,
    N = 0,
    t = 0,
    reserves = [],
    started = [],
  }: {
    C: number;
    A: number;
    N?: number;
    t?: number;
    reserves?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
    started?: ReadonlyArray<readonly [number, number, number]>;
  },
): string[] {
  const startedOrders: QueueOrder[] = started.map(([, S, B], i) => ({
    id: `started-${i}`,
    placedAt: m(S) - 5 * MINUTE,
    startedAt: m(S),
    items: [{ prepSeconds: B * 60 }],
  }));
  const queued: QueueOrder[] = orders.map((o, i) => ({
    id: `order-${i + 1}`,
    placedAt: m(o.T),
    seq: i + 1,
    placedUnderLoad: o.L === 1,
    acceptedAt: o.accepted === undefined ? null : m(o.accepted),
    items: toItems(o.items),
  }));
  const state: QueueState = {
    settings: { acceptSeconds: A * 60, loadExtraSeconds: N * 60, stations: C },
    orders: [...startedOrders, ...queued],
    blocked: reserves.flatMap((blocks, station) => blocks.map(([a, b]) => ({ station, from: m(a), to: m(b) }))),
  };
  const result = scheduleQueue(state, m(t));
  return result.orders.filter((o) => o.kind === 'queued').map((o) => hhmm(o.readyAt));
}

/**
 * The model's `windows(t, A, N, L, D_st, D, busy, close)` + `ranges`, for
 * C = 1. The calculator takes a basket rather than D_ст and D, so each check
 * passes a basket with exactly those: D_ст = Σ B of station positions,
 * D = max(D_ст, the longest parallel one). `busy` is station time taken by
 * the queue and by reserves; the store works 08:00–close.
 */
function windows({
  t,
  A,
  N,
  L,
  basket,
  busy,
  close,
}: {
  t: number;
  A: number;
  N: number;
  L: 0 | 1;
  basket: readonly ModelItem[];
  busy: ReadonlyArray<readonly [number, number]>;
  close: number;
}): string[] {
  const state: QueueState = {
    settings: { acceptSeconds: A * 60, loadExtraSeconds: N * 60, stations: 1 },
    orders: [],
    hours: [{ from: m(-4 * 60), to: m(close) }],
    loadOn: L === 1,
    blocked: busy.map(([a, b]) => ({ station: 0, from: m(a), to: m(b) })),
  };
  return preorderWindows(state, toItems(basket), m(t)).map((w) => `${hhmm(w.from)}–${hhmm(w.to)}`);
}

const times = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

describe('queue policy: reference model checks', () => {
  it('0 / по 1 американо', () => {
    expect(schedule(times(3, { T: 0, items: [AM] }), { C: 1, A: 5 })).toEqual(['12:06', '12:07', '12:08']);
  });

  it('0 / у №1 три американо', () => {
    expect(
      schedule(
        [
          { T: 0, items: times(3, AM) },
          { T: 0, items: [AM] },
          { T: 0, items: [AM] },
        ],
        { C: 1, A: 5 },
      ),
    ).toEqual(['12:08', '12:09', '12:10']);
  });

  it('3.2 / загрузка', () => {
    expect(schedule([{ T: 0, L: 1, items: [AM] }], { C: 1, A: 5, N: 10 })).toEqual(['12:16']);
  });

  it('6 / загрузка выкл', () => {
    expect(schedule([{ T: 0, L: 0, items: [AM] }], { C: 1, A: 5, N: 10 })).toEqual(['12:06']);
  });

  it('8.1 / C=2', () => {
    expect(
      schedule(
        [
          { T: 0, items: times(3, AM) },
          { T: 0, items: [AM] },
          { T: 0, items: [AM] },
        ],
        { C: 2, A: 5 },
      ),
    ).toEqual(['12:07', '12:07', '12:08']);
  });

  it('8.2 / разное время', () => {
    expect(
      schedule(
        [
          { T: 0, items: times(5, AM) },
          { T: 3, items: [AM] },
        ],
        { C: 1, A: 5 },
      ),
    ).toEqual(['12:10', '12:11']);
  });

  it('8.3 / разные напитки', () => {
    expect(
      schedule(
        [
          { T: 0, items: [AM, CAP] },
          { T: 0, items: [LAT] },
          { T: 0, items: [AM] },
        ],
        { C: 1, A: 5 },
      ),
    ).toEqual(['12:09', '12:11', '12:12']);
  });

  it('8.6 / FIFO + резерв', () => {
    expect(
      schedule(
        [
          { T: 3, items: [CAP] },
          { T: 3, items: [AM] },
        ],
        { C: 2, A: 5, reserves: [[[10, 20]], [[10, 20]]] },
      ),
    ).toEqual(['12:23', '12:21']);
  });

  it('8.6 / без FIFO было бы 12:09 (контроль)', () => {
    expect(schedule([{ T: 3, items: [AM] }], { C: 2, A: 5, reserves: [[[10, 20]], [[10, 20]]] })).toEqual(['12:09']);
  });

  it('8.7 / FIFO + загрузка', () => {
    expect(
      schedule(
        [
          { T: 0, L: 1, items: [AM] },
          { T: 1, L: 0, items: [AM] },
        ],
        { C: 2, A: 5, N: 10 },
      ),
    ).toEqual(['12:16', '12:16']);
  });

  it('8.8 / параллельные', () => {
    expect(
      schedule(
        [
          { T: 0, items: [BURG, FRIES, COLA] },
          { T: 0, items: [AM] },
          { T: 0, items: [COLA] },
          { T: 0, items: [AM] },
        ],
        { C: 1, A: 5 },
      ),
    ).toEqual(['12:11', '12:12', '12:12', '12:13']);
  });

  it('8.8 / без галочки', () => {
    expect(
      schedule(
        [
          {
            T: 0,
            items: [BURG, [4, false], [1, false]],
          },
        ],
        { C: 1, A: 5 },
      ),
    ).toEqual(['12:16']);
  });

  it('5 / начатая позиция, t=12:07', () => {
    expect(schedule([{ T: 7, items: [AM] }], { C: 1, A: 5, t: 7, started: [[0, 5, 5]] })).toEqual(['12:13']);
  });

  it('5 / начатая, новый заказ принят в 12:08', () => {
    expect(schedule([{ T: 7, accepted: 8, items: [AM] }], { C: 1, A: 5, t: 8, started: [[0, 5, 5]] })).toEqual([
      '12:11',
    ]);
  });

  it('5 / «Готово» не нажато в 12:12', () => {
    expect(schedule([{ T: 7, accepted: 8, items: [AM] }], { C: 1, A: 5, t: 12, started: [[0, 5, 5]] })).toEqual([
      '12:13',
    ]);
  });

  it('Принял / до принятия', () => {
    expect(schedule([{ T: 0, items: [AM] }], { C: 1, A: 5 })).toEqual(['12:06']);
  });

  it('Принял / в 12:03, свободен', () => {
    expect(schedule([{ T: 0, accepted: 3, items: [AM] }], { C: 1, A: 5, t: 3 })).toEqual(['12:04']);
  });

  it('Принял / в 12:03, занят до 12:07', () => {
    expect(schedule([{ T: 0, accepted: 3, items: [AM] }], { C: 1, A: 5, t: 3, started: [[0, 3, 4]] })).toEqual([
      '12:08',
    ]);
  });

  it('3.2 = 3.3 при C=1', () => {
    const seq: ModelOrder[] = (
      [
        [0, [1, 3]],
        [2, [2]],
        [2, [1, 1, 1]],
        [20, [3]],
        [21, [2]],
      ] as const
    ).map(([T, bs]) => ({ T, items: bs.map((b): ModelItem => [b, false]) }));
    let K = -Infinity;
    const short: number[] = [];
    for (const o of seq) {
      const G = Math.max(o.T + 5, K) + o.items.reduce((sum, [b]) => sum + b, 0);
      short.push(G);
      K = G;
    }
    expect(schedule(seq, { C: 1, A: 5 })).toEqual(short.map((G) => hhmm(m(G))));
    expect(schedule(seq, { C: 1, A: 5 })).toEqual(['12:09', '12:11', '12:14', '12:28', '12:30']);
  });

  it('8.5 / окна', () => {
    // D_ст = D = 6: two cappuccinos.
    expect(
      windows({
        t: 30,
        A: 5,
        N: 0,
        L: 0,
        basket: [CAP, CAP],
        busy: [
          [30, 50],
          [60, 70],
        ],
        close: 480,
      }),
    ).toEqual(['12:56–13:00', '13:16–20:00']);
  });

  it('7 / формула окна с параллельными', () => {
    // D_ст = 2, D = 8: a 2-minute station position and an 8-minute parallel one.
    expect(
      windows({
        t: 30,
        A: 5,
        N: 0,
        L: 0,
        basket: [
          [2, false],
          [8, true],
        ],
        busy: [
          [30, 50],
          [60, 70],
        ],
        close: 480,
      }),
    ).toEqual(['12:52–13:00', '13:12–20:00']);
  });

  it('7 / только параллельные', () => {
    // D_ст = 0, D = 4: a single 4-minute parallel position.
    expect(
      windows({
        t: 30,
        A: 5,
        N: 0,
        L: 0,
        basket: [[4, true]],
        busy: [
          [30, 50],
          [60, 70],
        ],
        close: 480,
      }),
    ).toEqual(['12:39–20:00']);
  });
});
