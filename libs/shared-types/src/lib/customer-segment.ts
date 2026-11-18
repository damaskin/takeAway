/**
 * The inactive-customer threshold — one for the whole product (owner,
 * 2026-11-18): a customer is inactive when they have ordered at least
 * {@link INACTIVE_MIN_ORDERS} times and not for N days. N is picked from
 * {@link INACTIVE_DAY_PRESETS} or typed as any whole number of days between
 * {@link MIN_INACTIVE_DAYS} and {@link MAX_INACTIVE_DAYS}.
 *
 * The same N means the same people on the dashboard card «Неактивные
 * клиенты», on «Аналитика → Возврат клиентов» («Сейчас неактивны»), in
 * «Клиенты → Неактивные», in the INACTIVE campaign audience and on promo
 * codes for inactive customers. Older choices (3 days, say) stay valid: they
 * are inside the bounds.
 */

/** Orders a customer needs before going quiet makes them inactive. */
export const INACTIVE_MIN_ORDERS = 3;

/** The ready-made thresholds the pickers offer; anything else in the bounds is «свой». */
export const INACTIVE_DAY_PRESETS = [7, 14, 30, 90] as const;

export const DEFAULT_INACTIVE_DAYS = 14;
export const MIN_INACTIVE_DAYS = 1;
export const MAX_INACTIVE_DAYS = 365;

/** A whole number of days within the bounds. */
export function isInactiveDays(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_INACTIVE_DAYS && value <= MAX_INACTIVE_DAYS
  );
}

/** A threshold from a link, a query string or a saved row; null when it is missing or out of bounds. */
export function parseInactiveDays(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return isInactiveDays(value) ? value : null;
}
