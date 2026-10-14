/**
 * The 15-minute pickup grid. A slot is a window of handovers, and capacity
 * is counted per slot: how many orders and how much kitchen work it holds.
 */

/** Granularity of a pickup slot. */
export const SLOT_MINUTES = 15;
export const SLOT_SECONDS = SLOT_MINUTES * 60;
export const SLOT_MS = SLOT_SECONDS * 1000;

export function floorToSlot(date: Date): Date {
  return new Date(Math.floor(date.getTime() / SLOT_MS) * SLOT_MS);
}

export function ceilToSlot(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / SLOT_MS) * SLOT_MS);
}

/** What one slot already holds: orders handed over in it and the kitchen work they cost. */
export interface SlotLoad {
  count: number;
  workSeconds: number;
}

/** The two capacity knobs of a store. */
export interface SlotCapacity {
  /** Most handovers in one slot. */
  slotCapacity: number;
  /** How many items the kitchen makes at once: one slot holds `SLOT_SECONDS × this` seconds of work. */
  kitchenParallelism: number;
}

/** Seconds of kitchen work one slot holds: 15 minutes for each pair of hands. */
export function slotWorkCapacity(store: SlotCapacity): number {
  return SLOT_SECONDS * Math.max(1, store.kitchenParallelism);
}

/**
 * Whether an order costing `workSeconds` of kitchen time still fits a slot.
 *
 * Full when the slot already holds `slotCapacity` orders, or when its work
 * plus this order's would be more than the kitchen does in 15 minutes. An
 * order bigger than a whole slot on its own (a catering run) still fits an
 * empty one — otherwise it could never be placed at all.
 */
export function slotFits(load: SlotLoad | undefined, store: SlotCapacity, workSeconds: number): boolean {
  const count = load?.count ?? 0;
  const work = load?.workSeconds ?? 0;
  if (count >= Math.max(1, store.slotCapacity)) return false;
  if (work === 0) return true;
  return work + Math.max(0, workSeconds) <= slotWorkCapacity(store);
}
