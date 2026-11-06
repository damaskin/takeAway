import { QueuePlanner, orderCanStartAt, positionsOf } from './planner';
import { MINUTE_MS } from './station-time';
import type {
  AsapQuote,
  PreorderWindowOptions,
  QueueAsapBlockedReason,
  QueueItem,
  QueueSchedule,
  QueueState,
  ReadyWindow,
} from './types';

/**
 * The order-queue policy (spec «Очередь и время готовности», docs/queue-policy.md):
 * pure functions of a store's state and `now`, no clock, database or network.
 */

/** How far ahead a pre-order may be placed (owner decision 2026-11-05: 24 hours, not only today). */
export const PREORDER_HORIZON_MS = 24 * 60 * 60 * 1000;

/** When every active order of the store will be ready, and where each position goes. */
export function scheduleQueue(state: QueueState, now: number): QueueSchedule {
  return new QueuePlanner(state, now).schedule();
}

/** The wait the customer sees next to the ready time: ⌈G − t⌉ minutes, never below 0 (spec 3.4). */
export function readyWaitMinutes(readyAt: number, now: number): number {
  return Math.max(0, Math.ceil((readyAt - now) / MINUTE_MS));
}

/**
 * «Если закажете сейчас — будет готово в 12:11 · ≈ 11 мин» (spec section 4):
 * the cart goes to the end of the queue as an order placed now, with A + N
 * while «Загрузка» is on. Not available outside the working hours, during
 * «Перерыв», and when it would be ready after the window it is placed in
 * closes («Не успеем до закрытия — выберите заказ ко времени»). An empty
 * cart answers when the kitchen could take a new order.
 */
export function quoteAsap(state: QueueState, items: readonly QueueItem[], now: number): AsapQuote {
  const planner = new QueuePlanner(state, now);
  const canStartAt = orderCanStartAt({ placedAt: now, placedUnderLoad: state.loadOn === true }, state.settings);
  const cart = planner.enqueue('', positionsOf(items), canStartAt);

  const window = state.hours ? (state.hours.find((w) => w.from <= now && now < w.to) ?? null) : null;
  let reason: QueueAsapBlockedReason | null = null;
  if (state.hours && !window) reason = 'OUTSIDE_HOURS';
  else if (state.paused) reason = 'PAUSED';
  else if (window && cart.readyAt > window.to) reason = 'CLOSING_SOON';

  return {
    available: reason === null,
    reason,
    readyAt: cart.readyAt,
    waitMinutes: readyWaitMinutes(cart.readyAt, now),
    startAt: cart.startAt,
    position: cart.position,
    closesAt: window?.to ?? null,
  };
}

/**
 * The times a basket can be pre-ordered for over the next 24 hours (spec
 * section 7), as runs of whole minutes. A time P qualifies when the basket's
 * station positions fit free station time ending at P — not over the queue,
 * the reserves of other pre-orders or blocked time — nothing starts before
 * t + A + N·L, and all of it lies within the working hours. With C = 1 that
 * is P ∈ [max(a + D_ст, t + A + N·L + D); b] for every free stretch [a; b].
 * A booked pre-order holds its reserve, so the next customer no longer sees
 * that time. None during «Перерыв».
 */
export function preorderWindows(
  state: QueueState,
  items: readonly QueueItem[],
  now: number,
  options: PreorderWindowOptions = {},
): ReadyWindow[] {
  if (state.paused) return [];
  const planner = new QueuePlanner(state, now);
  const positions = positionsOf(items);
  const earliest = orderCanStartAt({ placedAt: now, placedUnderLoad: state.loadOn === true }, state.settings);
  const last = now + (options.horizonMs ?? PREORDER_HORIZON_MS);

  const windows: ReadyWindow[] = [];
  let current: ReadyWindow | null = null;
  for (let readyBy = Math.ceil(now / MINUTE_MS) * MINUTE_MS; readyBy <= last; readyBy += MINUTE_MS) {
    if (!planner.fitsReadyBy(positions, readyBy, earliest, state.hours)) {
      current = null;
    } else if (current) {
      current.to = readyBy;
    } else {
      current = { from: readyBy, to: readyBy };
      windows.push(current);
    }
  }
  return windows;
}

/**
 * Whether a basket can be pre-ordered for exactly `readyBy` — the order path's
 * check, since the windows a customer saw may be stale by the time they pay.
 * Same rules as {@link preorderWindows}, at any instant, not only whole minutes.
 */
export function isPreorderTimeAvailable(
  state: QueueState,
  items: readonly QueueItem[],
  readyBy: number,
  now: number,
  options: PreorderWindowOptions = {},
): boolean {
  if (state.paused) return false;
  if (readyBy > now + (options.horizonMs ?? PREORDER_HORIZON_MS)) return false;
  const earliest = orderCanStartAt({ placedAt: now, placedUnderLoad: state.loadOn === true }, state.settings);
  return new QueuePlanner(state, now).fitsReadyBy(positionsOf(items), readyBy, earliest, state.hours);
}

export { orderCanStartAt };
