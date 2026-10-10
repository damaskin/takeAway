import type {
  CommissionRateSource,
  PayoutBlockReason,
  SettlementBalance,
  SettlementDay,
  SettlementRateSpan,
  SettlementTotals,
} from '@takeaway/shared-types';

import { rateAt, type RatePoint } from '../plans/commission-history';

/**
 * The money arithmetic of settlements with brands. Pure functions over
 * integer minor units — the service feeds them rows from the database.
 *
 * Definitions (docs/settlements.md has a worked example):
 *
 * - An order **counts** once a card payment for it was captured, or once the
 *   store accepted it. It is **settled at** its acceptance, or at its first
 *   captured payment when it was never accepted; that instant picks both its
 *   day and its commission rate.
 * - **Commission base** = card money captured − refunded. Only money the
 *   platform really received is shared: promo codes, points and gift cards
 *   never reach the platform's account.
 * - **Commission** = base × rate, in whole cents, rounded half up, per order.
 *   Rounding each order (not the day or the period) is what makes days add
 *   up to the period and periods to the year exactly.
 * - **Payable** to the brand = base − commission.
 */

export const BPS_DENOMINATOR = 10_000;

/** One order as the settlement query reads it. */
export interface SettlementOrderRow {
  id: string;
  settledAt: Date;
  /** Line items before any discount. */
  subtotalCents: number;
  /** Promo and points together, as the order stores them. */
  discountCents: number;
  pointsDiscountCents: number;
  giftCardCents: number;
  deliveryFeeCents: number;
  /** What the customer had to pay. */
  totalCents: number;
  /** Over the order's captured payments, in the order's currency. */
  capturedCents: number;
  refundedCents: number;
  hasCapture: boolean;
}

/**
 * Commission on `baseCents` at `bps` basis points, rounded half up to a whole
 * cent: 12.5 kopecks is 13, 12.49 is 12. Integer arithmetic throughout — no
 * floating-point cent ever exists.
 */
export function commissionCents(baseCents: number, bps: number): number {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0) {
    throw new RangeError(`baseCents must be a non-negative integer, got ${baseCents}`);
  }
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new RangeError(`bps must be an integer within 0..${BPS_DENOMINATOR}, got ${bps}`);
  }
  return Math.floor((baseCents * bps + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

export function emptyTotals(): SettlementTotals {
  return {
    orders: 0,
    cardOrders: 0,
    zeroTotalOrders: 0,
    unpaidOrders: 0,
    unpaidTotalCents: 0,
    salesCents: 0,
    promoDiscountCents: 0,
    pointsDiscountCents: 0,
    giftCardCents: 0,
    deliveryFeeCents: 0,
    capturedCents: 0,
    refundedCents: 0,
    commissionBaseCents: 0,
    commissionCents: 0,
    payableCents: 0,
  };
}

/** One order's contribution to every figure, at the rate in force when it settled. */
export function settleOrder(row: SettlementOrderRow, bps: number): SettlementTotals {
  const captured = row.hasCapture ? Math.max(0, row.capturedCents) : 0;
  // A refund never exceeds what was taken; clamp so base stays captured − refunded.
  const refunded = row.hasCapture ? Math.min(captured, Math.max(0, row.refundedCents)) : 0;
  const base = captured - refunded;
  const commission = commissionCents(base, bps);
  const unpaid = !row.hasCapture && row.totalCents > 0;
  return {
    orders: 1,
    cardOrders: row.hasCapture ? 1 : 0,
    zeroTotalOrders: !row.hasCapture && row.totalCents <= 0 ? 1 : 0,
    unpaidOrders: unpaid ? 1 : 0,
    unpaidTotalCents: unpaid ? row.totalCents : 0,
    salesCents: row.subtotalCents,
    promoDiscountCents: Math.max(0, row.discountCents - row.pointsDiscountCents),
    pointsDiscountCents: row.pointsDiscountCents,
    giftCardCents: row.giftCardCents,
    deliveryFeeCents: row.deliveryFeeCents,
    capturedCents: captured,
    refundedCents: refunded,
    commissionBaseCents: base,
    commissionCents: commission,
    payableCents: base - commission,
  };
}

const TOTAL_KEYS = Object.keys(emptyTotals()) as Array<keyof SettlementTotals>;

/** Adds the figures of `add` into `into` (a day keeps its date) and returns `into`. */
export function addTotals<T extends SettlementTotals>(into: T, add: SettlementTotals): T {
  for (const key of TOTAL_KEYS) {
    into[key] += add[key];
  }
  return into;
}

export interface SettlementWindow {
  /** First instant of the period. */
  start: Date;
  /** Instant right after the period (exclusive). */
  end: Date;
  /** Every local day of the period, in order. */
  days: readonly string[];
}

export interface SettlementComputation {
  totals: SettlementTotals;
  days: SettlementDay[];
  /** Payable for every order settled before the period: the opening side of the balance. */
  accruedBeforeCents: number;
  /** Payable for every order settled before the period ends. */
  accruedBeforeEndCents: number;
  /** Local day of the earliest counted order before the period ends; null when there is none. */
  firstSettledDay: string | null;
}

/**
 * Splits `rows` (every counted order settled before `window.end`) into the
 * period's days and what came before, each order at its own rate.
 */
export function computeSettlement(
  rows: readonly SettlementOrderRow[],
  timeline: readonly RatePoint[],
  fallbackBps: number,
  window: SettlementWindow,
  dayOf: (instant: Date) => string,
): SettlementComputation {
  const byDay = new Map<string, SettlementDay>(window.days.map((date) => [date, { date, ...emptyTotals() }]));
  const totals = emptyTotals();
  let accruedBefore = 0;
  let accruedBeforeEnd = 0;
  let firstSettledAt: Date | null = null;

  for (const row of rows) {
    if (row.settledAt.getTime() >= window.end.getTime()) continue;
    const settled = settleOrder(row, rateAt(timeline, row.settledAt, fallbackBps));
    accruedBeforeEnd += settled.payableCents;
    if (!firstSettledAt || row.settledAt < firstSettledAt) firstSettledAt = row.settledAt;
    if (row.settledAt.getTime() < window.start.getTime()) {
      accruedBefore += settled.payableCents;
      continue;
    }
    addTotals(totals, settled);
    const day = byDay.get(dayOf(row.settledAt));
    if (day) addTotals(day, settled);
  }

  return {
    totals,
    days: [...byDay.values()],
    accruedBeforeCents: accruedBefore,
    accruedBeforeEndCents: accruedBeforeEnd,
    firstSettledDay: firstSettledAt ? dayOf(firstSettledAt) : null,
  };
}

/** The card money and commission of the orders settled within [start, end). */
export function periodFigures(
  rows: readonly SettlementOrderRow[],
  timeline: readonly RatePoint[],
  fallbackBps: number,
  start: Date,
  end: Date,
): { cardNetCents: number; commissionCents: number } {
  let cardNet = 0;
  let commission = 0;
  for (const row of rows) {
    const t = row.settledAt.getTime();
    if (t < start.getTime() || t >= end.getTime()) continue;
    const settled = settleOrder(row, rateAt(timeline, row.settledAt, fallbackBps));
    cardNet += settled.commissionBaseCents;
    commission += settled.commissionCents;
  }
  return { cardNetCents: cardNet, commissionCents: commission };
}

/** What the balance needs to know about a payout. */
export interface LedgerPayout {
  /** The instant the period it settles ends at. */
  periodEnd: Date;
  /** Last local day it settles. */
  periodTo: string;
  amountCents: number;
  status: 'PENDING' | 'PAID';
}

/**
 * The balance around a period. "Owed at t" is everything payable for orders
 * settled before t minus the payouts already *paid* for periods ending by t —
 * a fixed but untransferred payout is still owed.
 */
export function settlementBalance(input: {
  accruedBeforeCents: number;
  payableCents: number;
  payouts: readonly LedgerPayout[];
  start: Date;
  end: Date;
}): SettlementBalance {
  const start = input.start.getTime();
  const end = input.end.getTime();
  let paidBefore = 0;
  let paidIn = 0;
  let pendingIn = 0;
  let pendingByEnd = 0;
  for (const p of input.payouts) {
    const t = p.periodEnd.getTime();
    if (t > end) continue;
    if (p.status === 'PENDING') pendingByEnd += p.amountCents;
    if (t <= start) {
      if (p.status === 'PAID') paidBefore += p.amountCents;
    } else if (p.status === 'PAID') {
      paidIn += p.amountCents;
    } else {
      pendingIn += p.amountCents;
    }
  }
  const opening = input.accruedBeforeCents - paidBefore;
  return {
    openingCents: opening,
    payableCents: input.payableCents,
    paidCents: paidIn,
    pendingCents: pendingIn,
    closingCents: opening + input.payableCents - paidIn,
    closingPendingCents: pendingByEnd,
  };
}

/**
 * The payout «Зафиксировать выплату» would create for the period ending on
 * `to`. Payouts follow each other: the new one starts the day after the last
 * one (or on the first counted order) and transfers the whole balance owed at
 * the end of `to` — what earlier payouts did not cover, refunds that came in
 * after them included.
 */
export function planPayout(input: {
  to: string;
  today: string;
  lastSettledDay: string | null;
  firstSettledDay: string | null;
  accruedBeforeEndCents: number;
  /** Every payout fixed so far, paid or not. */
  committedCents: number;
  nextDay: (day: string) => string;
}): { periodFrom: string | null; amountCents: number; blocked: PayoutBlockReason | null } {
  const amount = input.accruedBeforeEndCents - input.committedCents;
  const periodFrom = input.lastSettledDay ? input.nextDay(input.lastSettledDay) : input.firstSettledDay;
  let blocked: PayoutBlockReason | null = null;
  if (input.lastSettledDay && input.to <= input.lastSettledDay) blocked = 'OVERLAP';
  else if (input.to >= input.today) blocked = 'PERIOD_OPEN';
  else if (amount <= 0 || periodFrom === null) blocked = 'NOTHING_DUE';
  return { periodFrom, amountCents: amount, blocked };
}

/**
 * The rates in force during [start, end), as local days both included. Before
 * the first recorded rate the first one applies; without any history, the
 * brand's current rate does.
 */
export function rateSpans(
  timeline: ReadonlyArray<RatePoint & { source: CommissionRateSource }>,
  fallback: { bps: number; source: CommissionRateSource },
  start: Date,
  end: Date,
  dayOf: (instant: Date) => string,
): SettlementRateSpan[] {
  const last = new Date(end.getTime() - 1);
  if (timeline.length === 0) {
    return [{ bps: fallback.bps, source: fallback.source, from: dayOf(start), to: dayOf(last) }];
  }
  const spans: SettlementRateSpan[] = [];
  timeline.forEach((point, i) => {
    const next = timeline[i + 1];
    const from = i === 0 ? Number.NEGATIVE_INFINITY : point.effectiveFrom.getTime();
    const to = next ? next.effectiveFrom.getTime() : Number.POSITIVE_INFINITY;
    const lo = Math.max(from, start.getTime());
    const hi = Math.min(to, end.getTime());
    if (lo >= hi) return;
    const span = { bps: point.bps, source: point.source, from: dayOf(new Date(lo)), to: dayOf(new Date(hi - 1)) };
    const prev = spans[spans.length - 1];
    // Two rows with the same rate read as one span.
    if (prev && prev.bps === span.bps && prev.source === span.source) prev.to = span.to;
    else spans.push(span);
  });
  return spans;
}
