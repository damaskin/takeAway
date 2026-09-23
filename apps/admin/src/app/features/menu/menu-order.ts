/**
 * The list after moving one item up or down a step, or `null` when that
 * would take it past either end. The editor sends the whole new order to
 * the API, which renumbers every position — so positions that were all 0
 * (everything created before ordering existed) become a real order on the
 * first move.
 */
export function swapped<T>(list: readonly T[], index: number, target: number): T[] | null {
  const moving = list[index];
  const other = list[target];
  if (moving === undefined || other === undefined) return null;
  const next = [...list];
  next[index] = other;
  next[target] = moving;
  return next;
}
