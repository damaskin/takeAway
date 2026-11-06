import { isPreorderTimeAvailable, preorderWindows, quoteAsap, readyWaitMinutes, scheduleQueue } from './queue-policy';
import type { PlannedOrder, QueueItem, QueueOrder, QueueSchedule, QueueState } from './types';

/**
 * Every worked example of the spec «Очередь и время готовности» (sections 0,
 * 3, 4–9) and its acceptance criteria (section 10), with the calculator's own
 * inputs: orders, pre-orders and the store's settings.
 */

const DAY = '2026-11-06';
const at = (clock: string): number => Date.parse(`${DAY}T${clock.length === 5 ? `${clock}:00` : clock}Z`);
const clock = (ms: number): string => {
  const iso = new Date(ms).toISOString();
  return iso.slice(17, 19) === '00' ? iso.slice(11, 16) : iso.slice(11, 19);
};
const span = (from: number, to: number): string => `${clock(from)}–${clock(to)}`;

const americano: QueueItem = { prepSeconds: 60 };
const latte: QueueItem = { prepSeconds: 120 };
const cappuccino: QueueItem = { prepSeconds: 180 };
const burger: QueueItem = { prepSeconds: 360 };
const fries: QueueItem = { prepSeconds: 240, parallel: true };
const cola: QueueItem = { prepSeconds: 60, parallel: true };

const settings = ({ A = 5, N = 10, C = 1 }: { A?: number; N?: number; C?: number } = {}) => ({
  acceptSeconds: A * 60,
  loadExtraSeconds: N * 60,
  stations: C,
});

/** Ids and the FIFO tie-break both come from one counter: an order made later is later in the queue. */
let seq = 0;
function order(placed: string, items: QueueItem[], extra: Partial<QueueOrder> = {}): QueueOrder {
  seq += 1;
  return { id: `#${seq}`, placedAt: at(placed), seq, items, ...extra };
}

function byId(schedule: QueueSchedule, id: string): PlannedOrder {
  const found = schedule.orders.find((o) => o.id === id);
  if (!found) throw new Error(`no order ${id}`);
  return found;
}

/** The cooking span of an order's station positions: first start – last end. */
const cooking = (o: PlannedOrder): string => {
  const station = o.items.filter((i) => !i.parallel);
  return span(Math.min(...station.map((i) => i.startAt)), Math.max(...station.map((i) => i.endAt)));
};

/** Station positions as "station: from–to", in the order's position order. */
const layout = (o: PlannedOrder): string[] =>
  o.items.filter((i) => !i.parallel).map((i) => `${(i.station ?? -1) + 1}: ${span(i.startAt, i.endAt)}`);

const ready = (s: QueueSchedule): string[] => s.orders.map((o) => clock(o.readyAt));

describe('spec 0: the opening question (A = 5, B = 1, one station, everyone at 12:00)', () => {
  it('one americano each: 12:06, 12:07, 12:08', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [order('12:00', [americano]), order('12:00', [americano]), order('12:00', [americano])],
      },
      at('12:00'),
    );
    expect(s.orders.map(cooking)).toEqual(['12:05–12:06', '12:06–12:07', '12:07–12:08']);
    expect(ready(s)).toEqual(['12:06', '12:07', '12:08']);
  });

  it('three americanos for №1: 12:08, 12:09, 12:10 — A is not added for those behind', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [
          order('12:00', [{ ...americano, quantity: 3 }]),
          order('12:00', [americano]),
          order('12:00', [americano]),
        ],
      },
      at('12:00'),
    );
    expect(s.orders.map(cooking)).toEqual(['12:05–12:08', '12:08–12:09', '12:09–12:10']);
    expect(ready(s)).toEqual(['12:08', '12:09', '12:10']);
  });
});

describe('spec 3.2: the short formula G = max(R, K₋₁) + ΣB', () => {
  it('reproduces the check table', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [
          order('12:00', [{ ...americano, quantity: 3 }]),
          order('12:00', [americano]),
          order('12:00', [americano]),
        ],
      },
      at('12:00'),
    );
    expect(s.orders.map((o) => clock(o.canStartAt ?? 0))).toEqual(['12:05', '12:05', '12:05']);
    expect(ready(s)).toEqual(['12:08', '12:09', '12:10']);
  });

  it('«Загрузка» on (N = 10), the kitchen free: max(12:00 + 5 + 10, —) + 1 = 12:16', () => {
    const s = scheduleQueue(
      { settings: settings(), orders: [order('12:00', [americano], { placedUnderLoad: true })] },
      at('12:00'),
    );
    expect(ready(s)).toEqual(['12:16']);
  });
});

describe('spec 3.4 and 4: what the customer sees', () => {
  it('«Готов в 12:06 · ≈ 6 мин» for an americano at 12:00 with nobody ahead', () => {
    const quote = quoteAsap({ settings: settings(), orders: [] }, [americano], at('12:00'));
    expect(clock(quote.readyAt)).toBe('12:06');
    expect(quote.waitMinutes).toBe(6);
    expect(quote.available).toBe(true);
  });

  it('«Если закажете сейчас — будет готово в 12:11 · ≈ 11 мин» behind five americanos', () => {
    const quote = quoteAsap(
      { settings: settings(), orders: [order('12:00', [{ ...americano, quantity: 5 }])] },
      [americano],
      at('12:00'),
    );
    expect(clock(quote.readyAt)).toBe('12:11');
    expect(quote.waitMinutes).toBe(11);
    expect(quote.position).toBe(2);
  });

  it('rounds the wait up: 3.5 minutes show as 4', () => {
    const quote = quoteAsap(
      {
        settings: settings({ A: 1 }),
        orders: [order('12:00', [{ prepSeconds: 300 }], { startedAt: at('12:05') })],
      },
      [americano],
      at('12:07:30'),
    );
    expect(clock(quote.readyAt)).toBe('12:11');
    expect(quote.waitMinutes).toBe(4);
    expect(readyWaitMinutes(at('12:11'), at('12:07:30'))).toBe(4);
  });
});

describe('spec 5: statuses', () => {
  it('«Принял» sets R to the press, earlier than T + A', () => {
    const s = scheduleQueue(
      { settings: settings(), orders: [order('12:00', [americano], { acceptedAt: at('12:02') })] },
      at('12:02'),
    );
    expect(clock(s.orders[0]?.canStartAt ?? 0)).toBe('12:02');
    expect(ready(s)).toEqual(['12:03']);
  });

  it('an early «Принял» does not overtake the queue, even with a free station', () => {
    const s = scheduleQueue(
      {
        settings: settings({ C: 2 }),
        orders: [order('12:00', [americano]), order('12:01', [americano], { acceptedAt: at('12:02') })],
      },
      at('12:02'),
    );
    expect(s.orders.map(cooking)).toEqual(['12:05–12:06', '12:05–12:06']);
  });

  it('«Начал» holds the station until «Готово»: started 12:05, B = 5', () => {
    const started = order('12:00', [{ prepSeconds: 300 }], { startedAt: at('12:05') });
    const at1207 = scheduleQueue({ settings: settings(), orders: [started] }, at('12:07'));
    expect(at1207.stationFreeAt.map(clock)).toEqual(['12:10']);
    const at1212 = scheduleQueue({ settings: settings(), orders: [started] }, at('12:12'));
    expect(at1212.stationFreeAt.map(clock)).toEqual(['12:12']);
    expect(clock(byId(at1212, started.id).readyAt)).toBe('12:12');
  });

  it('«Готово» frees the station: the order leaves the input', () => {
    const next = order('12:07', [americano], { acceptedAt: at('12:08') });
    const busy = scheduleQueue(
      {
        settings: settings(),
        orders: [order('12:00', [{ prepSeconds: 300 }], { startedAt: at('12:05') }), next],
      },
      at('12:08'),
    );
    expect(clock(byId(busy, next.id).readyAt)).toBe('12:11');
    const done = scheduleQueue({ settings: settings(), orders: [next] }, at('12:08'));
    expect(clock(byId(done, next.id).readyAt)).toBe('12:09');
  });

  it('«Отмена» takes the order out and moves those behind it forward', () => {
    const first = order('12:00', [{ ...cappuccino, quantity: 2 }]);
    const second = order('12:00', [americano]);
    const before = scheduleQueue({ settings: settings(), orders: [first, second] }, at('12:00'));
    expect(clock(byId(before, second.id).readyAt)).toBe('12:12');
    const after = scheduleQueue({ settings: settings(), orders: [second] }, at('12:00'));
    expect(clock(byId(after, second.id).readyAt)).toBe('12:06');
  });

  it('a parallel position neither holds nor frees a station', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [
          order('12:00', [cola], { startedAt: at('12:05') }),
          order('12:01', [americano], { acceptedAt: at('12:05') }),
        ],
      },
      at('12:05'),
    );
    expect(s.orders.map((o) => clock(o.readyAt))).toEqual(['12:06', '12:06']);
    expect(s.orders[1] ? cooking(s.orders[1]) : '').toBe('12:05–12:06');
  });
});

describe('spec 6: «Загрузка» and «Перерыв»', () => {
  const free: QueueState = { settings: settings(), orders: [] };

  it('A = 5, N = 10, the kitchen free, one americano at 12:00: 12:06 off, 12:16 on', () => {
    expect(clock(quoteAsap(free, [americano], at('12:00')).readyAt)).toBe('12:06');
    expect(clock(quoteAsap({ ...free, loadOn: true }, [americano], at('12:00')).readyAt)).toBe('12:16');
  });

  it('acts on new orders only: an order placed before keeps its time', () => {
    const placed = order('12:00', [americano]);
    const s = scheduleQueue({ ...free, orders: [placed], loadOn: true }, at('12:01'));
    expect(ready(s)).toEqual(['12:06']);
    const quote = quoteAsap({ ...free, orders: [placed], loadOn: true }, [americano], at('12:01'));
    expect(clock(quote.readyAt)).toBe('12:17');
  });

  it('the pre-order windows count it too', () => {
    const state: QueueState = { ...free, hours: [{ from: at('08:00'), to: at('20:00') }] };
    const off = preorderWindows(state, [{ ...cappuccino, quantity: 2 }], at('12:30'));
    const on = preorderWindows({ ...state, loadOn: true }, [{ ...cappuccino, quantity: 2 }], at('12:30'));
    expect(off.map((w) => span(w.from, w.to))).toEqual(['12:41–20:00']);
    expect(on.map((w) => span(w.from, w.to))).toEqual(['12:51–20:00']);
  });

  it('«Перерыв»: no new orders of either kind; orders taken stay in the queue', () => {
    const state: QueueState = {
      ...free,
      paused: true,
      orders: [order('12:00', [americano])],
    };
    const quote = quoteAsap(state, [americano], at('12:12'));
    expect(quote.available).toBe(false);
    expect(quote.reason).toBe('PAUSED');
    expect(preorderWindows(state, [americano], at('12:12'))).toEqual([]);
    expect(isPreorderTimeAvailable(state, [americano], at('13:00'), at('12:12'))).toBe(false);
    expect(ready(scheduleQueue(state, at('12:12')))).toEqual(['12:13']);
  });
});

describe('spec 7: the window formula for C = 1', () => {
  it('P ∈ [max(a + D_ст, t + A + N·L + D); b] over every free stretch [a; b], whatever the basket', () => {
    const MIN = 60_000;
    const open = at('08:00');
    const close = at('20:00');
    const now = at('12:30');
    const busySets: Array<Array<[string, string]>> = [
      [],
      [['12:30', '12:50']],
      [
        ['12:30', '12:50'],
        ['13:00', '13:10'],
      ],
      [
        ['12:40', '12:45'],
        ['12:47', '12:52'],
        ['13:30', '14:00'],
      ],
    ];
    const baskets: QueueItem[][] = [
      [{ ...cappuccino, quantity: 2 }],
      [{ prepSeconds: 120 }, { prepSeconds: 480, parallel: true }],
      [{ prepSeconds: 240, parallel: true }],
      [americano],
      [{ ...cappuccino, quantity: 3 }],
      [cappuccino, { prepSeconds: 600, parallel: true }],
    ];
    for (const busy of busySets) {
      for (const items of baskets) {
        for (const loadOn of [false, true]) {
          const ms = (i: QueueItem): number => i.prepSeconds * 1000;
          const dSt = items.filter((i) => !i.parallel).reduce((sum, i) => sum + ms(i) * (i.quantity ?? 1), 0);
          const d = Math.max(dSt, ...items.filter((i) => i.parallel).map(ms));
          const earliest = now + 5 * MIN + (loadOn ? 10 * MIN : 0) + d;
          const blocks = busy.map(([a, b]) => ({ from: at(a), to: at(b) }));
          const gaps: Array<[number, number]> = [];
          let a = open;
          for (const block of blocks) {
            gaps.push([a, block.from]);
            a = block.to;
          }
          gaps.push([a, close]);
          const expected = (dSt === 0 ? [[open, close] as [number, number]] : gaps)
            .map(([from, to]) => [Math.max(from + dSt, earliest), to])
            .filter(([lo = 0, hi = 0]) => Math.ceil(lo / MIN) * MIN <= hi)
            .map(([lo = 0, hi = 0]) => span(Math.ceil(lo / MIN) * MIN, Math.floor(hi / MIN) * MIN));

          const state: QueueState = {
            settings: settings(),
            orders: [],
            hours: [{ from: open, to: close }],
            loadOn,
            blocked: blocks.map((b) => ({ station: 0, ...b })),
          };
          expect(preorderWindows(state, items, now).map((w) => span(w.from, w.to))).toEqual(expected);
        }
      }
    }
  });
});

describe('spec 8: check scenarios', () => {
  it('8.1 two stations: the table, station by station', () => {
    const s = scheduleQueue(
      {
        settings: settings({ C: 2 }),
        orders: [
          order('12:00', [{ ...americano, quantity: 3 }]),
          order('12:00', [americano]),
          order('12:00', [americano]),
        ],
      },
      at('12:00'),
    );
    expect(s.orders.map(layout)).toEqual([
      ['1: 12:05–12:06', '2: 12:05–12:06', '1: 12:06–12:07'],
      ['2: 12:06–12:07'],
      ['1: 12:07–12:08'],
    ]);
    expect(ready(s)).toEqual(['12:07', '12:07', '12:08']);
  });

  it('8.2 orders at different times: №2 waits for the kitchen, not for its R', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [order('12:00', [{ ...americano, quantity: 5 }]), order('12:03', [americano])],
      },
      at('12:03'),
    );
    expect(s.orders.map(cooking)).toEqual(['12:05–12:10', '12:10–12:11']);
    expect(clock(s.orders[1]?.canStartAt ?? 0)).toBe('12:08');
    expect(ready(s)).toEqual(['12:10', '12:11']);
  });

  it('8.3 different drinks', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [order('12:00', [americano, cappuccino]), order('12:00', [latte]), order('12:00', [americano])],
      },
      at('12:00'),
    );
    expect(s.orders.map(cooking)).toEqual(['12:05–12:09', '12:09–12:11', '12:11–12:12']);
    expect(ready(s)).toEqual(['12:09', '12:11', '12:12']);
  });

  it('8.4 an unplanned «Перерыв» at 12:10: the queue keeps its promise; a cancel moves the rest forward', () => {
    const first = order('12:00', [{ ...cappuccino, quantity: 3 }], { startedAt: at('12:05') });
    const second = order('12:01', [{ ...americano, quantity: 6 }]);
    const state: QueueState = { settings: settings(), orders: [first, second], paused: true };

    const quote = quoteAsap(state, [americano], at('12:12'));
    expect(quote.reason).toBe('PAUSED');
    expect(preorderWindows(state, [americano], at('12:12'))).toEqual([]);

    const s = scheduleQueue(state, at('12:12'));
    expect(ready(s)).toEqual(['12:14', '12:20']);

    const afterCancel = scheduleQueue({ ...state, orders: [second] }, at('12:12'));
    expect(ready(afterCancel)).toEqual(['12:18']);
  });

  describe('8.5 a pre-order: now 12:30, the queue until 12:50, a reserve 13:00–13:10, closing 20:00', () => {
    const queue = order('12:25', [{ prepSeconds: 20 * 60 }]);
    const otherCustomer = order('12:20', [{ prepSeconds: 10 * 60 }], { readyBy: at('13:10') });
    const state: QueueState = {
      settings: settings(),
      orders: [queue, otherCustomer],
      hours: [{ from: at('08:00'), to: at('20:00') }],
    };
    const twoCappuccinos = [{ ...cappuccino, quantity: 2 }];

    it('the kitchen is taken 12:30–12:50 and 13:00–13:10', () => {
      const s = scheduleQueue(state, at('12:30'));
      expect(s.busy.map((station) => station.map((b) => span(b.from, b.to)))).toEqual([['12:30–12:50', '13:00–13:10']]);
      expect(clock(byId(s, otherCustomer.id).readyAt)).toBe('13:10');
    });

    it('2 cappuccinos (D_ст = D = 6) may be ready 12:56–13:00 and 13:16–20:00', () => {
      const windows = preorderWindows(state, twoCappuccinos, at('12:30'));
      expect(windows.map((w) => span(w.from, w.to))).toEqual(['12:56–13:00', '13:16–20:00']);
    });

    it('the time picked is reserved at once and gone for the next customer', () => {
      expect(isPreorderTimeAvailable(state, twoCappuccinos, at('12:58'), at('12:30'))).toBe(true);
      const booked = order('12:30', twoCappuccinos, { readyBy: at('12:58') });
      const after: QueueState = { ...state, orders: [...state.orders, booked] };
      const s = scheduleQueue(after, at('12:30'));
      expect(byId(s, booked.id).items.map((i) => span(i.startAt, i.endAt))).toEqual(['12:52–12:55', '12:55–12:58']);
      expect(preorderWindows(after, twoCappuccinos, at('12:30')).map((w) => span(w.from, w.to))).toEqual([
        '13:16–20:00',
      ]);
      expect(preorderWindows(after, [americano], at('12:30')).map((w) => span(w.from, w.to))).toEqual([
        '12:51–12:52',
        '12:59–13:00',
        '13:11–20:00',
      ]);
    });

    it('an ASAP order goes around the reserve and does not move it', () => {
      const three = quoteAsap(state, [{ ...cappuccino, quantity: 3 }], at('12:30'));
      expect(clock(three.readyAt)).toBe('12:59');
      const four = quoteAsap(state, [{ ...cappuccino, quantity: 4 }], at('12:30'));
      expect(clock(four.readyAt)).toBe('13:13');
      expect(clock(byId(scheduleQueue(state, at('12:30')), otherCustomer.id).readyAt)).toBe('13:10');
    });
  });

  it('8.6 FIFO with C = 2 and a reserve on both stations 12:10–12:20', () => {
    const preorder = order('11:00', [{ prepSeconds: 600, quantity: 2 }], { readyBy: at('12:20') });
    const first = order('12:03', [cappuccino]);
    const second = order('12:03', [americano]);
    const s = scheduleQueue({ settings: settings({ C: 2 }), orders: [preorder, first, second] }, at('12:03'));
    expect(layout(byId(s, preorder.id)).sort()).toEqual(['1: 12:10–12:20', '2: 12:10–12:20']);
    expect(clock(byId(s, first.id).canStartAt ?? 0)).toBe('12:08');
    expect(cooking(byId(s, first.id))).toBe('12:20–12:23');
    expect(cooking(byId(s, second.id))).toBe('12:20–12:21');
    expect([byId(s, first.id), byId(s, second.id)].map((o) => clock(o.readyAt))).toEqual(['12:23', '12:21']);
  });

  it('8.7 FIFO with C = 2 and «Загрузка»', () => {
    const s = scheduleQueue(
      {
        settings: settings({ C: 2 }),
        orders: [
          order('12:00', [americano], { placedUnderLoad: true }),
          order('12:01', [americano], { placedUnderLoad: false }),
        ],
      },
      at('12:01'),
    );
    expect(s.orders.map((o) => clock(o.canStartAt ?? 0))).toEqual(['12:15', '12:06']);
    expect(s.orders.map(cooking)).toEqual(['12:15–12:16', '12:15–12:16']);
    expect(ready(s)).toEqual(['12:16', '12:16']);
  });

  it('8.8 parallel positions: O, K and G of each order', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [
          order('12:00', [burger, fries, cola]),
          order('12:00', [americano]),
          order('12:00', [cola]),
          order('12:00', [americano]),
        ],
      },
      at('12:00'),
    );
    expect(s.orders.map((o) => clock(o.startAt))).toEqual(['12:05', '12:11', '12:11', '12:12']);
    expect(s.orders.map((o) => clock(o.stationsFreeAt))).toEqual(['12:11', '12:12', '12:11', '12:13']);
    expect(s.orders[0]?.items.filter((i) => i.parallel).map((i) => span(i.startAt, i.endAt))).toEqual([
      '12:05–12:09',
      '12:05–12:06',
    ]);
    expect(s.orders[2]?.items.map((i) => i.station)).toEqual([null]);
    expect(ready(s)).toEqual(['12:11', '12:12', '12:12', '12:13']);
    expect(s.stationFreeAt.map(clock)).toEqual(['12:13']);
  });

  it('8.8 without the flag the same positions add up: 6 + 4 + 1 = 11 minutes, ready 12:16', () => {
    const s = scheduleQueue(
      {
        settings: settings(),
        orders: [order('12:00', [burger, { prepSeconds: 240 }, { prepSeconds: 60 }])],
      },
      at('12:00'),
    );
    expect(ready(s)).toEqual(['12:16']);
  });

  it('8.8 a coffee shop: 3 americanos without the flag are still 3 minutes in a row', () => {
    const s = scheduleQueue(
      { settings: settings(), orders: [order('12:00', [{ ...americano, quantity: 3 }])] },
      at('12:00'),
    );
    expect(s.orders.map(cooking)).toEqual(['12:05–12:08']);
  });
});

describe('spec 9: limits', () => {
  it('ASAP is not available when it would be ready after the closing', () => {
    const state: QueueState = {
      settings: settings(),
      orders: [order('19:40', [{ ...cappuccino, quantity: 2 }])],
      hours: [{ from: at('08:00'), to: at('20:00') }],
    };
    const quote = quoteAsap(state, [americano], at('19:50'));
    expect(clock(quote.readyAt)).toBe('19:57');
    expect(quote.available).toBe(true);
    const atClosing = quoteAsap(state, [cappuccino, americano], at('19:50'));
    expect(clock(atClosing.readyAt)).toBe('20:00');
    expect(atClosing.available).toBe(true);
    const late = quoteAsap(state, [{ ...cappuccino, quantity: 2 }], at('19:50'));
    expect(clock(late.readyAt)).toBe('20:02');
    expect(late.available).toBe(false);
    expect(late.reason).toBe('CLOSING_SOON');
    expect(clock(late.closesAt ?? 0)).toBe('20:00');
  });

  it('with C > 1 a later short order may be ready before an earlier long one', () => {
    const s = scheduleQueue(
      {
        settings: settings({ C: 2 }),
        orders: [order('12:00', [{ ...cappuccino, quantity: 3 }]), order('12:00', [americano])],
      },
      at('12:00'),
    );
    expect(ready(s)).toEqual(['12:11', '12:09']);
  });
});

describe('spec 10: acceptance', () => {
  it('a changed setting is used at once: nothing is fixed in code', () => {
    const orders = [order('12:00', [americano]), order('12:00', [latte])];
    expect(ready(scheduleQueue({ settings: settings({ A: 5 }), orders }, at('12:00')))).toEqual(['12:06', '12:08']);
    expect(ready(scheduleQueue({ settings: settings({ A: 2 }), orders }, at('12:00')))).toEqual(['12:03', '12:05']);
    expect(ready(scheduleQueue({ settings: settings({ A: 2, C: 2 }), orders }, at('12:00')))).toEqual([
      '12:03',
      '12:04',
    ]);
  });

  it('two positions are made at once with C = 2', () => {
    const s = scheduleQueue(
      { settings: settings({ C: 2 }), orders: [order('12:00', [{ ...latte, quantity: 2 }])] },
      at('12:00'),
    );
    expect(s.orders.map(layout)).toEqual([['1: 12:05–12:07', '2: 12:05–12:07']]);
  });
});
