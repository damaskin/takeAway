import type { AsapBlockedReason } from '@takeaway/shared-types';

import { closingAfter, type HoursAround, openingAfter, windowAt, withinHours } from '../kitchen/opening-hours';
import { ceilToSlot } from '../kitchen/slots';

/**
 * When a store takes orders — the one place that decides (kitchen policy,
 * docs/kitchen-policy.md).
 *
 * Working hours win over the shift for ASAP orders: an order "for now" is
 * taken only while the store is within its hours — or the kitchen extended
 * past them («Продлить») — the kitchen has not paused it («Пауза»), a shift
 * is open (the schedule opens and closes it by itself since 2026-10-20), an
 * order placed now would be ready before the closing, and the queue would
 * hand it over within `MAX_ASAP_WAIT_SECONDS`. Pre-orders for later do not
 * need the shift: a customer at 01:00 can book 09:15 tomorrow.
 *
 * The catalog, the realtime `store.availabilityChanged` broadcast, the cart,
 * the order path and the kitchen board all read these functions, so
 * changing what "open" means is a change here and nowhere else.
 */

/** The numbers the rules below run on; KitchenLoadService reads them from the environment. */
export interface AvailabilityPolicy {
  /** Longest wait an ASAP order may be quoted (`MAX_ASAP_WAIT_SECONDS`); past it the queue is full. */
  maxAsapWaitSeconds: number;
  /** A pre-order is for at least this far ahead (10 minutes). */
  minScheduledLeadSeconds: number;
  /** ...and at most this far (24 hours). */
  preorderHorizonSeconds: number;
  /**
   * With nobody on shift, or for a window that has not opened yet, the first
   * bookable slot is this long after the opening (`PREORDER_OPENING_LEAD_MINUTES`):
   * whoever opens needs a moment before the first handover.
   */
  preorderOpeningLeadSeconds: number;
}

/** What {@link storeAvailability} needs to know about one store right now. */
export interface AvailabilityFacts {
  status: string;
  /** The open shift (`closedAt = null`), if any. */
  openShift: { extendedUntil: Date | null } | null;
  /**
   * Seconds until an ASAP order placed now would be handed over, the queue,
   * a typical order's cooking and full slots included (KitchenLoadService);
   * null when no slot within reach fits one.
   */
  asapWaitSeconds: number | null;
  /** The kitchen paused the store until then (`Store.pausedUntil`); a moment already past is no pause. */
  pausedUntil?: Date | null;
}

/** The store's answer to "can I order?", on the catalog DTOs and the kitchen shift. */
export interface StoreAvailability {
  /** Some order can be placed: ASAP now, or a pre-order for a bookable slot in the next 24 hours. */
  acceptingOrders: boolean;
  /** An ASAP order placed now would be taken. */
  openNow: boolean;
  /** Why not, when `openNow` is false; null for a store switched off (CLOSED) — `acceptingOrders` says it. */
  asapBlockedReason: AsapBlockedReason | null;
  /** Start of the next working-hours window while outside the hours (a week ahead at most). */
  opensAt: Date | null;
  /** End of the current window while within the hours; null outside them and around the clock. */
  closesAt: Date | null;
  /** Within the working hours right now (a store with none on file always is). */
  withinHours: boolean;
  /** The kitchen takes ASAP orders past the hours until this moment; null with no extension running. */
  extendedUntil: Date | null;
  /** The kitchen paused the store until this moment; null when it is not paused (or the pause ran out). */
  pausedUntil: Date | null;
}

/** Why a pickup time cannot be booked, before capacity is even looked at. */
export type SlotBlocker = 'TOO_SOON' | 'TOO_FAR' | 'PAUSED' | 'OUTSIDE_HOURS' | 'BEFORE_OPENING_LEAD';

export interface SlotContext {
  now: Date;
  hours: HoursAround;
  /** A shift is open at the store right now. */
  shiftOpen: boolean;
  policy: AvailabilityPolicy;
  /** The kitchen paused the store until then: nothing is handed over before it. */
  pausedUntil?: Date | null;
}

/**
 * Whether a pickup time may be booked as a pre-order, capacity aside: it is
 * at least 10 minutes and at most 24 hours away, not before the end of a
 * kitchen pause, inside the working hours, and — while nobody is on shift,
 * or for a window that has not opened yet — at least
 * `PREORDER_OPENING_LEAD_MINUTES` after that window opens.
 */
export function slotBlocker(at: Date, { now, hours, shiftOpen, policy, pausedUntil }: SlotContext): SlotBlocker | null {
  const t = at.getTime();
  if (t < now.getTime() + policy.minScheduledLeadSeconds * 1000) return 'TOO_SOON';
  if (t > now.getTime() + policy.preorderHorizonSeconds * 1000) return 'TOO_FAR';
  if (pausedUntil && t < pausedUntil.getTime()) return 'PAUSED';
  if (hours.alwaysOpen) return null;
  const window = windowAt(hours, at);
  if (!window) return 'OUTSIDE_HOURS';
  if (
    needsOpeningLead(window.start, now, shiftOpen) &&
    t < window.start.getTime() + policy.preorderOpeningLeadSeconds * 1000
  ) {
    return 'BEFORE_OPENING_LEAD';
  }
  return null;
}

/** The opening lead applies unless the window is already running with a shift open. */
function needsOpeningLead(windowStart: Date, now: Date, shiftOpen: boolean): boolean {
  return !shiftOpen || windowStart > now;
}

/**
 * The store's availability right now. Precedence of the ASAP reasons:
 * outside the hours (no extension), then a kitchen pause, then no shift,
 * then an order for now that would not be ready before the closing, then a
 * full queue.
 */
export function storeAvailability(
  facts: AvailabilityFacts,
  now: Date,
  policy: AvailabilityPolicy,
  hours: HoursAround,
): StoreAvailability {
  const switchedOff = facts.status === 'CLOSED';
  const inHours = withinHours(hours, now);
  const shiftOpen = facts.openShift !== null;
  const extension = facts.openShift?.extendedUntil ?? null;
  const extendedUntil = extension && extension > now ? extension : null;
  const pausedUntil = facts.pausedUntil && facts.pausedUntil > now ? facts.pausedUntil : null;
  const closesAt = inHours ? closingAfter(hours, now) : null;
  const boundary = closingBoundary({ closesAt, extendedUntil });
  // With the queue full an order for now is handed over later than the
  // longest wait, so a closing before that is missed whatever the queue does.
  const readyBy = now.getTime() + (facts.asapWaitSeconds ?? policy.maxAsapWaitSeconds) * 1000;

  let reason: AsapBlockedReason | null = null;
  if (!inHours && !extendedUntil) reason = 'OUTSIDE_HOURS';
  else if (pausedUntil) reason = 'PAUSED';
  else if (!shiftOpen) reason = 'SHIFT_CLOSED';
  else if (boundary && readyBy > boundary.getTime()) reason = 'CLOSING_SOON';
  else if (facts.asapWaitSeconds === null || facts.asapWaitSeconds > policy.maxAsapWaitSeconds) reason = 'QUEUE_FULL';

  const openNow = !switchedOff && reason === null;
  return {
    openNow,
    acceptingOrders: !switchedOff && (openNow || hasBookableSlot({ now, hours, shiftOpen, policy, pausedUntil })),
    asapBlockedReason: switchedOff ? null : reason,
    opensAt: inHours ? null : openingAfter(hours, now),
    closesAt,
    withinHours: inHours,
    extendedUntil,
    pausedUntil,
  };
}

/**
 * The last moment an ASAP order may be handed over: the end of the current
 * working-hours window, or of the kitchen's extension when that is later.
 * Null for a store open around the clock (and one whose hours do not close
 * within the week), and outside the hours with no extension running.
 */
export function closingBoundary(store: { closesAt: Date | null; extendedUntil: Date | null }): Date | null {
  const { closesAt, extendedUntil } = store;
  if (closesAt && extendedUntil) return extendedUntil > closesAt ? extendedUntil : closesAt;
  return closesAt ?? extendedUntil;
}

/**
 * Whether some pre-order slot in the next 24 hours passes {@link slotBlocker}.
 * Capacity is left out — a store booked solid for a day is a store with
 * customers, not a closed one, and checkout shows the full slots struck out.
 */
export function hasBookableSlot(ctx: SlotContext): boolean {
  const { now, hours, shiftOpen, policy, pausedUntil } = ctx;
  const earliest = Math.max(now.getTime() + policy.minScheduledLeadSeconds * 1000, pausedUntil?.getTime() ?? 0);
  const latest = now.getTime() + policy.preorderHorizonSeconds * 1000;
  if (hours.alwaysOpen) return ceilToSlot(new Date(earliest)).getTime() <= latest;
  for (const window of hours.windows) {
    if (window.end.getTime() <= earliest) continue;
    if (window.start.getTime() > latest) break;
    const lead = needsOpeningLead(window.start, now, shiftOpen) ? policy.preorderOpeningLeadSeconds * 1000 : 0;
    const slot = ceilToSlot(new Date(Math.max(window.start.getTime() + lead, earliest))).getTime();
    if (slot < window.end.getTime() && slot <= latest) return true;
  }
  return false;
}

/**
 * "We're swamped" — the kitchen's «Загружены» switch. It is the store status
 * OVERLOADED, the same value the owner can pick in the store editor, so the
 * two never disagree. Busy is not closed: the store keeps taking orders.
 */
export function isBusy(store: { status: string }): boolean {
  return store.status === 'OVERLOADED';
}

/** What a store marked busy reports as its load: full. */
export const BUSY_METER_FULL = 100;

/**
 * The 0–100 load the storefronts colour a store by (green / amber / red).
 * A store marked busy reads as full; otherwise the stored value stands
 * (0 unless someone set it).
 *
 * It colours the store and nothing else: the ETA a customer is quoted comes
 * from the real queue (KitchenLoadService) and does not read this — only
 * the busy switch itself, which adds `BUSY_EXTRA_WAIT_SECONDS` to it.
 */
export function busyMeterOf(store: { status: string; busyMeter: number }): number {
  return isBusy(store) ? BUSY_METER_FULL : store.busyMeter;
}
