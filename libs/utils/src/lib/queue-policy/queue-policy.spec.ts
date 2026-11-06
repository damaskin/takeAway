import {
  PREORDER_HORIZON_MS,
  isPreorderTimeAvailable,
  orderCanStartAt,
  preorderWindows,
  quoteAsap,
  readyWaitMinutes,
  scheduleQueue,
} from './queue-policy';
import type { PlannedOrder, QueueItem, QueueOrder, QueueSchedule, QueueState, TimeRange } from './types';

/** Edge cases beyond the spec's own examples. */

const at = (clock: string, day = '2026-11-06'): number =>
  Date.parse(`${day}T${clock.length === 5 ? `${clock}:00` : clock}Z`);
const TOMORROW = '2026-11-07';
const clock = (ms: number): string => {
  const iso = new Date(ms).toISOString();
  const time = iso.slice(17, 19) === '00' ? iso.slice(11, 16) : iso.slice(11, 19);
  return iso.slice(0, 10) === '2026-11-06' ? time : `${iso.slice(8, 10)}/${time}`;
};
const span = (r: TimeRange): string => `${clock(r.from)}–${clock(r.to)}`;

const americano: QueueItem = { prepSeconds: 60 };
const cappuccino: QueueItem = { prepSeconds: 180 };
const fries: QueueItem = { prepSeconds: 240, parallel: true };
const cola: QueueItem = { prepSeconds: 60, parallel: true };

const settings = ({ A = 5, N = 10, C = 1 }: { A?: number; N?: number; C?: number } = {}) => ({
  acceptSeconds: A * 60,
  loadExtraSeconds: N * 60,
  stations: C,
});
const dayHours = (day = '2026-11-06'): TimeRange => ({ from: at('08:00', day), to: at('20:00', day) });

let seq = 0;
function order(placed: string, items: QueueItem[], extra: Partial<QueueOrder> = {}): QueueOrder {
  seq += 1;
  return { id: `#${seq}`, placedAt: at(placed), seq, items, ...extra };
}

const ready = (s: QueueSchedule): string[] => s.orders.map((o) => clock(o.readyAt));
const layout = (o: PlannedOrder | undefined): string[] =>
  (o?.items ?? []).map((i) => `${i.station === null ? 'p' : i.station + 1}: ${span({ from: i.startAt, to: i.endAt })}`);
const windowsOf = (state: QueueState, items: QueueItem[], now: number): string[] =>
  preorderWindows(state, items, now).map(span);

describe('empty queue', () => {
  const state: QueueState = { settings: settings({ C: 2 }), orders: [] };

  it('has every station free now and no last start', () => {
    const s = scheduleQueue(state, at('12:00'));
    expect(s.orders).toEqual([]);
    expect(s.stationFreeAt.map(clock)).toEqual(['12:00', '12:00']);
    expect(s.lastStartAt).toBeNull();
    expect(s.busy).toEqual([[], []]);
  });

  it('quotes a cart at t + A + its cooking, first in line', () => {
    const quote = quoteAsap(state, [cappuccino], at('12:00'));
    expect(clock(quote.readyAt)).toBe('12:08');
    expect(clock(quote.startAt)).toBe('12:05');
    expect(quote.position).toBe(1);
    expect(quote.closesAt).toBeNull();
  });

  it('an empty cart answers when the kitchen could take a new order', () => {
    expect(clock(quoteAsap(state, [], at('12:00')).readyAt)).toBe('12:05');
  });
});

describe('positions and stations', () => {
  it('a quantity unfolds into positions; zero means none', () => {
    const lines = scheduleQueue(
      { settings: settings(), orders: [order('12:00', [americano, americano, americano])] },
      at('12:00'),
    );
    const quantity = scheduleQueue(
      {
        settings: settings(),
        orders: [
          order('12:00', [
            { ...americano, quantity: 3 },
            { ...cappuccino, quantity: 0 },
          ]),
        ],
      },
      at('12:00'),
    );
    expect(layout(quantity.orders[0])).toEqual(layout(lines.orders[0]));
    expect(ready(quantity)).toEqual(['12:08']);
  });

  it('more positions than stations take turns on them', () => {
    const s = scheduleQueue(
      { settings: settings({ C: 2 }), orders: [order('12:00', [{ ...americano, quantity: 5 }])] },
      at('12:00'),
    );
    expect(layout(s.orders[0])).toEqual([
      '1: 12:05–12:06',
      '2: 12:05–12:06',
      '1: 12:06–12:07',
      '2: 12:06–12:07',
      '1: 12:07–12:08',
    ]);
    expect(ready(s)).toEqual(['12:08']);
  });

  it('fewer positions than stations leave the rest free', () => {
    const s = scheduleQueue(
      { settings: settings({ C: 3 }), orders: [order('12:00', [{ ...americano, quantity: 2 }])] },
      at('12:00'),
    );
    expect(s.stationFreeAt.map(clock)).toEqual(['12:06', '12:06', '12:00']);
  });

  it('a long parallel position decides the order, not the station: the next order starts at K', () => {
    const s = scheduleQueue(
      { settings: settings(), orders: [order('12:00', [americano, fries]), order('12:00', [americano])] },
      at('12:00'),
    );
    expect(s.orders.map((o) => clock(o.stationsFreeAt))).toEqual(['12:06', '12:07']);
    expect(ready(s)).toEqual(['12:09', '12:07']);
  });

  it('an order of parallel positions only takes no station and does not move the next one', () => {
    const s = scheduleQueue(
      { settings: settings(), orders: [order('12:00', [cola, fries]), order('12:00', [americano])] },
      at('12:00'),
    );
    expect(layout(s.orders[0])).toEqual(['p: 12:05–12:06', 'p: 12:05–12:09']);
    expect(ready(s)).toEqual(['12:09', '12:06']);
  });
});

describe('FIFO', () => {
  it('goes by placedAt whatever the input order, and keeps the input order in the result', () => {
    const late = order('12:02', [americano]);
    const early = order('12:00', [americano]);
    const s = scheduleQueue({ settings: settings(), orders: [late, early] }, at('12:00'));
    expect(s.orders.map((o) => o.id)).toEqual([late.id, early.id]);
    expect(s.orders.map((o) => o.position)).toEqual([2, 1]);
    expect(ready(s)).toEqual(['12:08', '12:06']);
  });

  it('breaks a tie in placedAt by seq, then by the input order', () => {
    const a = { ...order('12:00', [americano]), seq: 2 };
    const b = { ...order('12:00', [americano]), seq: 1 };
    expect(ready(scheduleQueue({ settings: settings(), orders: [a, b] }, at('12:00')))).toEqual(['12:07', '12:06']);
    const c = { ...order('12:00', [americano]), seq: undefined };
    const d = { ...order('12:00', [americano]), seq: undefined };
    expect(ready(scheduleQueue({ settings: settings(), orders: [c, d] }, at('12:00')))).toEqual(['12:06', '12:07']);
  });
});

describe('«Начать» for the whole order', () => {
  it('lays a started order out over the stations from its start', () => {
    const started = order('12:00', [{ ...americano, quantity: 3 }], { startedAt: at('12:05') });
    const next = order('12:00', [americano]);
    const s = scheduleQueue({ settings: settings({ C: 2 }), orders: [started, next] }, at('12:05'));
    expect(layout(s.orders[0])).toEqual(['1: 12:05–12:06', '2: 12:05–12:06', '1: 12:06–12:07']);
    expect(layout(s.orders[1])).toEqual(['2: 12:06–12:07']);
    expect(s.orders.map((o) => o.kind)).toEqual(['started', 'queued']);
  });

  it('is never ready before now while «Готово» is not pressed', () => {
    const started = order('12:00', [cola], { startedAt: at('12:05') });
    expect(ready(scheduleQueue({ settings: settings(), orders: [started] }, at('12:30')))).toEqual(['12:30']);
  });

  it('stays put over a reserve; the queue goes around both', () => {
    const preorder = order('11:00', [{ prepSeconds: 240 }], { readyBy: at('12:10') });
    const started = order('12:00', [{ ...americano, quantity: 3 }], { startedAt: at('12:05') });
    const next = order('12:01', [americano]);
    const s = scheduleQueue({ settings: settings(), orders: [preorder, started, next] }, at('12:05'));
    expect(layout(s.orders[0])).toEqual(['1: 12:06–12:10']);
    expect(layout(s.orders[1])).toEqual(['1: 12:05–12:06', '1: 12:06–12:07', '1: 12:07–12:08']);
    expect(layout(s.orders[2])).toEqual(['1: 12:10–12:11']);
  });

  it('a started pre-order gives up its reserve and counts from its start', () => {
    const preorder = order('11:00', [{ ...cappuccino, quantity: 2 }], {
      readyBy: at('13:00'),
      startedAt: at('12:40'),
    });
    const s = scheduleQueue({ settings: settings(), orders: [preorder] }, at('12:41'));
    expect(s.orders[0]?.kind).toBe('started');
    expect(ready(s)).toEqual(['12:46']);
    expect(s.busy[0]?.map(span)).toEqual(['12:40–12:43', '12:43–12:46']);
  });
});

describe('reserves of pre-orders', () => {
  it('lays station positions from the end and parallel ones to end at P', () => {
    const preorder = order('11:00', [cappuccino, americano, fries], { readyBy: at('13:00') });
    const s = scheduleQueue({ settings: settings(), orders: [preorder] }, at('12:00'));
    expect(layout(s.orders[0])).toEqual(['1: 12:56–12:59', '1: 12:59–13:00', 'p: 12:56–13:00']);
    expect(clock(s.orders[0]?.startAt ?? 0)).toBe('12:56');
    expect(ready(s)).toEqual(['13:00']);
  });

  it('a long parallel position starts the order earlier than its station positions', () => {
    const preorder = order('11:00', [americano, { prepSeconds: 600, parallel: true }], { readyBy: at('13:00') });
    const s = scheduleQueue({ settings: settings(), orders: [preorder] }, at('12:00'));
    expect(clock(s.orders[0]?.startAt ?? 0)).toBe('12:50');
  });

  it('booked one after another, a later reserve goes around an earlier one', () => {
    const first = order('11:00', [{ prepSeconds: 600 }], { readyBy: at('13:10') });
    const second = order('11:05', [{ prepSeconds: 600 }], { readyBy: at('13:10') });
    const one = scheduleQueue({ settings: settings(), orders: [second, first] }, at('12:00'));
    expect(one.orders.map(layout)).toEqual([['1: 12:50–13:00'], ['1: 13:00–13:10']]);
    const two = scheduleQueue({ settings: settings({ C: 2 }), orders: [second, first] }, at('12:00'));
    expect(two.orders.map(layout)).toEqual([['1: 13:00–13:10'], ['2: 13:00–13:10']]);
  });
});

describe('working hours and the closing', () => {
  const hours = [dayHours(), dayHours(TOMORROW)];

  it('orders already taken are forecast past the closing, not moved to the next day', () => {
    const late = order('19:50', [{ ...cappuccino, quantity: 2 }]);
    expect(ready(scheduleQueue({ settings: settings(), orders: [late], hours }, at('19:58')))).toEqual(['20:04']);
  });

  it('outside the hours ASAP is OUTSIDE_HOURS, before PAUSED', () => {
    const quote = quoteAsap({ settings: settings(), orders: [], hours, paused: true }, [americano], at('21:00'));
    expect(quote.available).toBe(false);
    expect(quote.reason).toBe('OUTSIDE_HOURS');
    expect(quote.closesAt).toBeNull();
    expect(quoteAsap({ settings: settings(), orders: [], hours: [] }, [americano], at('12:00')).reason).toBe(
      'OUTSIDE_HOURS',
    );
  });

  it('within the hours ASAP knows the closing it was checked against', () => {
    const quote = quoteAsap({ settings: settings(), orders: [], hours }, [americano], at('12:00'));
    expect(quote.available).toBe(true);
    expect(clock(quote.closesAt ?? 0)).toBe('20:00');
  });

  it('a store open around the clock never closes', () => {
    const quote = quoteAsap({ settings: settings(), orders: [], hours: null }, [americano], at('23:59'));
    expect(quote.available).toBe(true);
    expect(quote.closesAt).toBeNull();
  });
});

describe('pre-order windows over 24 hours', () => {
  it('a store open around the clock: one window up to 24 hours ahead, whole minutes', () => {
    const windows = windowsOf({ settings: settings(), orders: [] }, [americano], at('12:00:30'));
    expect(windows).toEqual(['12:07–07/12:00']);
  });

  it('today and tomorrow within the hours; nothing past 24 hours', () => {
    const state: QueueState = { settings: settings(), orders: [], hours: [dayHours(), dayHours(TOMORROW)] };
    expect(windowsOf(state, [americano], at('12:00'))).toEqual(['12:06–20:00', '07/08:01–07/12:00']);
  });

  it('before the opening the first time is the opening plus the cooking', () => {
    const state: QueueState = { settings: settings(), orders: [], hours: [dayHours(TOMORROW)] };
    expect(windowsOf(state, [{ ...cappuccino, quantity: 2 }], at('22:00'))).toEqual(['07/08:06–07/20:00']);
  });

  it('C = 2 makes two positions side by side, or one after another when a station is taken', () => {
    const items = [{ ...cappuccino, quantity: 2 }];
    const free: QueueState = { settings: settings({ C: 2 }), orders: [], hours: [dayHours()] };
    expect(windowsOf(free, items, at('12:00'))).toEqual(['12:08–20:00']);
    const oneTaken: QueueState = { ...free, blocked: [{ station: 0, from: at('12:00'), to: at('14:00') }] };
    expect(windowsOf(oneTaken, items, at('12:00'))).toEqual(['12:11–20:00']);
  });

  it('none when the stations are taken all day, all when the basket needs no station', () => {
    const state: QueueState = {
      settings: settings(),
      orders: [],
      hours: [dayHours()],
      blocked: [{ station: 0, from: at('08:00'), to: at('20:00') }],
    };
    expect(windowsOf(state, [americano], at('12:00'))).toEqual([]);
    expect(windowsOf(state, [cola], at('12:00'))).toEqual(['12:06–20:00']);
  });

  it('checks an exact time to the second on the order path', () => {
    const state: QueueState = {
      settings: settings(),
      orders: [],
      hours: [dayHours()],
      blocked: [
        { station: 0, from: at('12:30'), to: at('12:50') },
        { station: 0, from: at('13:00'), to: at('13:10') },
      ],
    };
    const items = [{ ...cappuccino, quantity: 2 }];
    const now = at('12:30');
    expect(isPreorderTimeAvailable(state, items, at('12:56:30'), now)).toBe(true);
    expect(isPreorderTimeAvailable(state, items, at('12:55:59'), now)).toBe(false);
    expect(isPreorderTimeAvailable(state, items, at('13:00:30'), now)).toBe(false);
    expect(isPreorderTimeAvailable(state, items, at('13:15:59'), now)).toBe(false);
    expect(isPreorderTimeAvailable(state, items, at('20:00'), now)).toBe(true);
    expect(isPreorderTimeAvailable(state, items, at('20:00:01'), now)).toBe(false);
    expect(isPreorderTimeAvailable(state, items, at('12:00'), now)).toBe(false);
  });

  it('stops at the horizon', () => {
    const state: QueueState = { settings: settings(), orders: [] };
    const now = at('12:00');
    expect(isPreorderTimeAvailable(state, [americano], now + PREORDER_HORIZON_MS, now)).toBe(true);
    expect(isPreorderTimeAvailable(state, [americano], now + PREORDER_HORIZON_MS + 1, now)).toBe(false);
    expect(preorderWindows(state, [americano], now, { horizonMs: 60 * 60 * 1000 }).map(span)).toEqual(['12:06–13:00']);
  });
});

describe('settings and inputs', () => {
  it('R is the accept, else T + A, plus N when placed under load', () => {
    const s = settings({ A: 5, N: 10 });
    expect(clock(orderCanStartAt({ placedAt: at('12:00') }, s))).toBe('12:05');
    expect(clock(orderCanStartAt({ placedAt: at('12:00'), placedUnderLoad: true }, s))).toBe('12:15');
    expect(clock(orderCanStartAt({ placedAt: at('12:00'), placedUnderLoad: true, acceptedAt: at('12:01') }, s))).toBe(
      '12:01',
    );
  });

  it('treats a missing or broken station count as one, a negative time as none', () => {
    const orders = [order('12:00', [{ prepSeconds: -60 }, americano])];
    expect(ready(scheduleQueue({ settings: { ...settings(), stations: 0 }, orders }, at('12:00')))).toEqual(['12:06']);
    expect(scheduleQueue({ settings: { ...settings(), stations: Number.NaN }, orders }, at('12:00')).busy).toHaveLength(
      1,
    );
  });

  it('ignores blocked time of a station the store does not have, and empty blocks', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [order('12:00', [americano])],
        blocked: [
          { station: 3, from: at('12:00'), to: at('13:00') },
          { station: 0, from: at('12:05'), to: at('12:05') },
        ],
      },
      at('12:00'),
    );
    expect(ready(s)).toEqual(['12:06']);
  });
});

describe('readyWaitMinutes', () => {
  it('rounds up and never goes below zero', () => {
    expect(readyWaitMinutes(at('12:06'), at('12:00'))).toBe(6);
    expect(readyWaitMinutes(at('12:06:01'), at('12:00'))).toBe(7);
    expect(readyWaitMinutes(at('12:00'), at('12:00'))).toBe(0);
    expect(readyWaitMinutes(at('11:59'), at('12:00'))).toBe(0);
  });
});
