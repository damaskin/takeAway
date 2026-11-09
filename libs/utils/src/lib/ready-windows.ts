/**
 * The client side of the queue policy's pre-order windows
 * (`GET /stores/:id/ready-windows`, docs/queue-policy.md 2.5): turning the
 * runs of free minutes into times a customer picks from, and the ready
 * time shown for an order.
 */

const MINUTE_MS = 60_000;

/** A run of pre-order times: every whole minute from `from` to `to`, both included (ISO). */
export interface ReadyWindowRange {
  from: string;
  to: string;
}

/**
 * The times offered in a pre-order picker: each window's first minute, then
 * every `stepMinutes` on the clock inside it, and its last minute — so a
 * short window («12:56–13:00») still offers both ends. Sorted, ISO, no
 * duplicates.
 */
export function readyWindowTimes(windows: readonly ReadyWindowRange[], stepMinutes = 5): string[] {
  const step = Math.max(1, Math.floor(stepMinutes)) * MINUTE_MS;
  const times = new Set<number>();
  for (const window of windows) {
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
    times.add(from);
    for (let at = Math.ceil(from / step) * step; at <= to; at += step) times.add(at);
    times.add(to);
  }
  return [...times].sort((a, b) => a - b).map((at) => new Date(at).toISOString());
}

/** Whether `at` is one of the windows' minutes. */
export function inReadyWindows(windows: readonly ReadyWindowRange[], at: string): boolean {
  const t = Date.parse(at);
  return windows.some((w) => Date.parse(w.from) <= t && t <= Date.parse(w.to));
}

/**
 * A ready time as the customer sees it (spec 3.4): the clock time rounded
 * up to the minute, so it is never early, and the wait in whole minutes,
 * rounded up, never below 0 — «готово в 12:11 · ≈ 11 мин».
 */
export function readyTimeShown(readyAt: string, now: number): { at: string; minutes: number } {
  const ready = Date.parse(readyAt);
  return {
    at: new Date(Math.ceil(ready / MINUTE_MS) * MINUTE_MS).toISOString(),
    minutes: Math.max(0, Math.ceil((ready - now) / MINUTE_MS)),
  };
}
