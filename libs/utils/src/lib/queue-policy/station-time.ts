import type { TimeRange } from './types';

/** One minute, ms: the grid of pre-order times and the unit of the wait the customer sees. */
export const MINUTE_MS = 60_000;

/**
 * The earliest `s ≥ from` such that `[s, s + duration)` misses every block:
 * a position is never interrupted, so one that does not fit before a block
 * starts when the block ends (spec 3.3).
 */
export function earliestStart(from: number, duration: number, blocks: readonly TimeRange[]): number {
  let start = from;
  let moved = true;
  while (moved) {
    moved = false;
    for (const block of blocks) {
      if (start < block.to && start + duration > block.from) {
        start = block.to;
        moved = true;
      }
    }
  }
  return start;
}

/** The latest `e ≤ until` such that `[e − duration, e)` misses every block — the same, from the end. */
export function latestEnd(until: number, duration: number, blocks: readonly TimeRange[]): number {
  let end = until;
  let moved = true;
  while (moved) {
    moved = false;
    for (const block of blocks) {
      if (end - duration < block.to && end > block.from) {
        end = block.from;
        moved = true;
      }
    }
  }
  return end;
}

/** Whether `[from, to)` meets any block. */
export function overlapsAny(from: number, to: number, blocks: readonly TimeRange[]): boolean {
  return blocks.some((block) => from < block.to && to > block.from);
}
