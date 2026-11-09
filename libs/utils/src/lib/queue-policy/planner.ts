import { earliestStart, latestEnd, overlapsAny } from './station-time';
import type {
  PlannedItem,
  PlannedOrder,
  QueueItem,
  QueueOrder,
  QueueSettings,
  QueueSchedule,
  QueueState,
  TimeRange,
} from './types';

/** One position: a unit of a line, quantities unfolded (3 americanos are 3 positions). */
export interface Position {
  index: number;
  prepSeconds: number;
  prepMs: number;
  parallel: boolean;
}

export function positionsOf(items: readonly QueueItem[]): Position[] {
  const positions: Position[] = [];
  for (const item of items) {
    const count = item.quantity === undefined ? 1 : Math.max(0, Math.floor(item.quantity));
    const prepSeconds = nonNegative(item.prepSeconds);
    for (let i = 0; i < count; i++) {
      positions.push({
        index: positions.length,
        prepSeconds,
        prepMs: prepSeconds * 1000,
        parallel: item.parallel === true,
      });
    }
  }
  return positions;
}

interface Settings {
  acceptMs: number;
  loadExtraMs: number;
  stations: number;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalize(settings: QueueSettings): Settings {
  return {
    acceptMs: nonNegative(settings.acceptSeconds) * 1000,
    loadExtraMs: nonNegative(settings.loadExtraSeconds) * 1000,
    stations: Math.max(1, Math.floor(settings.stations) || 1),
  };
}

/**
 * R — when the kitchen may start an order: T + A + N·L, or the moment staff
 * pressed «Принял» (spec 3.1, section 5). An early accept does not let the
 * order overtake the queue: FIFO still holds through S_пред.
 */
export function orderCanStartAt(
  order: Pick<QueueOrder, 'placedAt' | 'placedUnderLoad' | 'acceptedAt'>,
  settings: QueueSettings,
): number {
  if (order.acceptedAt !== undefined && order.acceptedAt !== null) return order.acceptedAt;
  const { acceptMs, loadExtraMs } = normalize(settings);
  return order.placedAt + acceptMs + (order.placedUnderLoad ? loadExtraMs : 0);
}

interface Station {
  index: number;
  /** fⱼ: free for the next queued position. */
  freeAt: number;
  /** Reserves and blocked time: queued positions go around them. */
  blocks: TimeRange[];
  /** Everything taken: positions, reserves, blocked time. */
  busy: TimeRange[];
}

interface Entry {
  order: QueueOrder;
  index: number;
  positions: Position[];
}

function fifo(a: Entry, b: Entry): number {
  return a.order.placedAt - b.order.placedAt || (a.order.seq ?? 0) - (b.order.seq ?? 0) || a.index - b.index;
}

function plannedItem(position: Position, station: number | null, startAt: number): PlannedItem {
  return {
    index: position.index,
    prepSeconds: position.prepSeconds,
    parallel: position.parallel,
    station,
    startAt,
    endAt: startAt + position.prepMs,
  };
}

function longestParallel(positions: readonly Position[]): number {
  return positions.reduce((longest, p) => (p.parallel ? Math.max(longest, p.prepMs) : longest), 0);
}

/**
 * Lays one store's orders out on its stations (spec section 4):
 *
 * 1. Reserves of the pre-orders not started yet, in booking order, each
 *    position as close to P as it fits («с конца», section 7).
 * 2. Orders with «Начать» pressed, from their start, never moved. A station
 *    is busy at least until now: only «Готово» (the order leaving the input)
 *    frees it.
 * 3. The ASAP orders not started yet, FIFO by T: each station position on
 *    the station where it starts first, not before R, the station, now and
 *    the start of the previous position in the queue (S_пред), and around
 *    reserves (3.3). Parallel positions take no station and run from O (3.5).
 *
 * Built once per question; a quote or a pre-order check is asked of the
 * state left after step 3.
 */
export class QueuePlanner {
  private readonly settings: Settings;
  private readonly stations: Station[];
  private lastStartAt = -Infinity;
  private queued = 0;
  private readonly planned: PlannedOrder[];

  constructor(
    state: QueueState,
    private readonly now: number,
  ) {
    this.settings = normalize(state.settings);
    this.stations = Array.from({ length: this.settings.stations }, (_, index) => ({
      index,
      freeAt: -Infinity,
      blocks: [],
      busy: [],
    }));
    for (const block of state.blocked ?? []) {
      const station = this.stations[block.station];
      if (!station || !(block.to > block.from)) continue;
      station.blocks.push({ from: block.from, to: block.to });
      station.busy.push({ from: block.from, to: block.to });
    }

    const reserved: Array<[Entry, number]> = [];
    const started: Array<[Entry, number]> = [];
    const queued: Entry[] = [];
    state.orders.forEach((order, index) => {
      const entry = { order, index, positions: positionsOf(order.items) };
      if (order.startedAt !== undefined && order.startedAt !== null) started.push([entry, order.startedAt]);
      else if (order.readyBy !== undefined && order.readyBy !== null) reserved.push([entry, order.readyBy]);
      else queued.push(entry);
    });

    const results: Array<[number, PlannedOrder]> = [];
    reserved.sort(([a], [b]) => fifo(a, b));
    for (const [entry, readyBy] of reserved) results.push([entry.index, this.reserve(entry, readyBy)]);

    started.sort(([a, aStart], [b, bStart]) => aStart - bStart || fifo(a, b));
    for (const [entry, startedAt] of started) results.push([entry.index, this.start(entry, startedAt)]);
    for (const station of this.stations) station.freeAt = Math.max(station.freeAt, now);

    queued.sort(fifo);
    for (const entry of queued) {
      results.push([
        entry.index,
        this.enqueue(entry.order.id, entry.positions, orderCanStartAt(entry.order, state.settings)),
      ]);
    }

    this.planned = results.sort(([a], [b]) => a - b).map(([, planned]) => planned);
  }

  schedule(): QueueSchedule {
    return {
      now: this.now,
      orders: this.planned,
      stationFreeAt: this.stations.map((s) => s.freeAt),
      lastStartAt: Number.isFinite(this.lastStartAt) ? this.lastStartAt : null,
      busy: this.stations.map((s) => [...s.busy].sort((a, b) => a.from - b.from || a.to - b.to)),
    };
  }

  /**
   * Puts an ASAP order at the end of the queue (spec 3.3, 3.5). Mutates the
   * planner: the next order queues behind this one.
   */
  enqueue(id: string, positions: readonly Position[], canStartAt: number): PlannedOrder & { position: number } {
    const position = ++this.queued;
    const items: PlannedItem[] = [];
    let firstStart: number | null = null;
    let lastEnd = -Infinity;
    for (const pos of positions) {
      if (pos.parallel) continue;
      let best: { station: Station; start: number } | null = null;
      for (const station of this.stations) {
        const from = Math.max(canStartAt, station.freeAt, this.now, this.lastStartAt);
        const start = earliestStart(from, pos.prepMs, station.blocks);
        if (!best || start < best.start) best = { station, start };
      }
      if (!best) continue;
      const end = best.start + pos.prepMs;
      best.station.freeAt = end;
      best.station.busy.push({ from: best.start, to: end });
      this.lastStartAt = best.start;
      firstStart ??= best.start;
      lastEnd = Math.max(lastEnd, end);
      items.push(plannedItem(pos, best.station.index, best.start));
    }

    let startAt: number;
    if (firstStart === null) {
      // Only parallel positions: no station, but still not before the queue reaches it.
      startAt = Math.max(canStartAt, this.now, this.lastStartAt);
      this.lastStartAt = startAt;
    } else {
      startAt = firstStart;
    }
    for (const pos of positions) if (pos.parallel) items.push(plannedItem(pos, null, startAt));
    items.sort((a, b) => a.index - b.index);

    const stationsFreeAt = firstStart === null ? startAt : lastEnd;
    return {
      id,
      kind: 'queued',
      position,
      canStartAt,
      startAt,
      stationsFreeAt,
      readyAt: Math.max(stationsFreeAt, startAt + longestParallel(positions)),
      items,
    };
  }

  /**
   * Whether a basket can be ready exactly at `readyBy` (spec section 7): its
   * station positions laid out from the end — the last one ending at P, each
   * earlier one ending no later than the one after it and as late as its
   * station allows — must all fit free station time without being pushed
   * earlier by somebody else's position, reserve or blocked time; nothing may
   * start before `earliest` (t + A + N·L); and the whole of it, parallel
   * positions included, lies within one window of the working hours.
   */
  fitsReadyBy(
    positions: readonly Position[],
    readyBy: number,
    earliest: number,
    hours: readonly TimeRange[] | null | undefined,
  ): boolean {
    let window: TimeRange | undefined;
    if (hours) {
      window = hours.find((w) => w.from <= readyBy && readyBy <= w.to);
      if (!window) return false;
    }

    const ownFrom = new Map<Station, number>();
    let nextEnd = readyBy;
    let startAt = readyBy;
    for (let k = positions.length - 1; k >= 0; k--) {
      const pos = positions[k];
      if (!pos || pos.parallel) continue;
      let best: { station: Station; end: number } | null = null;
      for (const station of this.stations) {
        const end = Math.min(ownFrom.get(station) ?? readyBy, nextEnd);
        const start = end - pos.prepMs;
        if (start < earliest || overlapsAny(start, end, station.busy)) continue;
        // Ties go to the later station: the queue fills stations from the first one.
        if (!best || end >= best.end) best = { station, end };
      }
      if (!best) return false;
      const start = best.end - pos.prepMs;
      ownFrom.set(best.station, start);
      nextEnd = best.end;
      startAt = Math.min(startAt, start);
    }
    startAt = Math.min(startAt, readyBy - longestParallel(positions));
    if (startAt < earliest) return false;
    return !window || startAt >= window.from;
  }

  /**
   * A pre-order not started yet holds its reserve: each station position
   * ends as close to P as it can (the last at P), going around the reserves
   * booked before it and blocked time; parallel positions end at P. The
   * reserve was checked against the queue when the customer booked it, so
   * it is laid out again without looking at the queue or the hours.
   */
  private reserve(entry: Entry, readyBy: number): PlannedOrder {
    const items: PlannedItem[] = [];
    const ownFrom = new Map<Station, number>();
    let nextEnd = readyBy;
    let startAt = readyBy;
    let stationsFreeAt: number | null = null;
    for (let k = entry.positions.length - 1; k >= 0; k--) {
      const pos = entry.positions[k];
      if (!pos || pos.parallel) continue;
      let best: { station: Station; end: number } | null = null;
      for (const station of this.stations) {
        const end = latestEnd(Math.min(ownFrom.get(station) ?? readyBy, nextEnd), pos.prepMs, station.blocks);
        if (!best || end >= best.end) best = { station, end };
      }
      if (!best) continue;
      const range = { from: best.end - pos.prepMs, to: best.end };
      best.station.blocks.push(range);
      best.station.busy.push({ ...range });
      ownFrom.set(best.station, range.from);
      nextEnd = best.end;
      startAt = Math.min(startAt, range.from);
      stationsFreeAt = Math.max(stationsFreeAt ?? -Infinity, best.end);
      items.push(plannedItem(pos, best.station.index, range.from));
    }
    for (const pos of entry.positions) {
      if (!pos.parallel) continue;
      items.push(plannedItem(pos, null, readyBy - pos.prepMs));
      startAt = Math.min(startAt, readyBy - pos.prepMs);
    }
    items.sort((a, b) => a.index - b.index);
    return {
      id: entry.order.id,
      kind: 'reserved',
      position: null,
      canStartAt: null,
      startAt,
      stationsFreeAt: stationsFreeAt ?? startAt,
      readyAt: readyBy,
      items,
    };
  }

  /**
   * An order with «Начать» pressed: the kitchen is on it, so it is laid out
   * from its start whatever the reserves, and stays put. Its stations are
   * busy at least until now, and it is ready no sooner than now — only
   * «Готово» says otherwise.
   */
  private start(entry: Entry, startedAt: number): PlannedOrder {
    const items: PlannedItem[] = [];
    let lastEnd: number | null = null;
    for (const pos of entry.positions) {
      if (pos.parallel) continue;
      let best: { station: Station; start: number } | null = null;
      for (const station of this.stations) {
        const start = Math.max(startedAt, station.freeAt, this.lastStartAt);
        if (!best || start < best.start) best = { station, start };
      }
      if (!best) continue;
      const end = best.start + pos.prepMs;
      best.station.freeAt = end;
      best.station.busy.push({ from: best.start, to: Math.max(end, this.now) });
      this.lastStartAt = best.start;
      lastEnd = Math.max(lastEnd ?? -Infinity, end);
      items.push(plannedItem(pos, best.station.index, best.start));
    }
    if (lastEnd === null) this.lastStartAt = Math.max(this.lastStartAt, startedAt);
    for (const pos of entry.positions) if (pos.parallel) items.push(plannedItem(pos, null, startedAt));
    items.sort((a, b) => a.index - b.index);

    const stationsFreeAt = lastEnd === null ? startedAt : Math.max(lastEnd, this.now);
    return {
      id: entry.order.id,
      kind: 'started',
      position: null,
      canStartAt: null,
      startAt: startedAt,
      stationsFreeAt,
      readyAt: Math.max(stationsFreeAt, startedAt + longestParallel(entry.positions), this.now),
      items,
    };
  }
}
