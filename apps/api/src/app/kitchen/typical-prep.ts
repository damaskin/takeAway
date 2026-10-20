/**
 * A store's typical preparation time: the median `Product.prepTimeSeconds`
 * of what a customer can order there right now — visible, listed in that
 * store, in a category sold on its own, not on the store's stop-list.
 *
 * It is the cooking part of the «готово через N мин» every storefront shows
 * (`currentEtaSeconds`), so a customer who looks at a store sees base time +
 * queue + how long a usual order takes to make, not the base time alone
 * (manager's list 2026-10-20, item 9).
 *
 * The figure changes only when the menu or the stop-list does, so it is
 * kept in memory for a few minutes per store rather than read on every
 * store-list request; the admin forgets a store's figure when its stop-list
 * or the brand's menu changes.
 */

/** How long a store's figure is kept before it is read again. */
export const TYPICAL_PREP_TTL_MS = 3 * 60_000;

/** The median of the values, rounded to whole seconds; 0 for none. */
export function medianSeconds(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return Math.round(median);
}

/** Per-store figures with an expiry. One per process: every API instance keeps its own. */
export class TypicalPrepCache {
  private readonly entries = new Map<string, { seconds: number; expiresAt: number }>();

  get(storeId: string, now: number): number | undefined {
    const entry = this.entries.get(storeId);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(storeId);
      return undefined;
    }
    return entry.seconds;
  }

  set(storeId: string, seconds: number, now: number): void {
    this.entries.set(storeId, { seconds, expiresAt: now + TYPICAL_PREP_TTL_MS });
  }

  /** The store's menu or stop-list changed; with no id, every store's (a product of the brand changed). */
  forget(storeId?: string): void {
    if (storeId) this.entries.delete(storeId);
    else this.entries.clear();
  }
}

/** The cache KitchenLoadService reads and the admin menu and stop-list editors clear. */
export const typicalPrepCache = new TypicalPrepCache();
