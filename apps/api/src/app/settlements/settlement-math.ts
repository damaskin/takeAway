import type {
  CommissionRateSource,
  PayoutBlockReason,
  PayoutStatus,
  SettlementBalance,
  SettlementDirection,
  SettlementDay,
  SettlementRateSpan,
  SettlementTotals,
} from '@takeaway/shared-types';

import { rateAt, type RatePoint } from '../plans/commission-history';

/**
 * The money arithmetic of settlements with brands. Pure functions over
 * integer minor units — the service feeds them rows from the database.
 *
 * Since 2026-11-14 guests pay the brand directly (docs/settlements.md has the
 * definitions and a worked example):
 *
 * - An order **counts** once a card payment for it was captured, or once the
 *   store accepted it. It is **settled at** its acceptance, or at its first
 *   captured payment when it was never accepted; that instant picks both its
 *   day and its commission rate.
 * - **Compensation** — what takeAway owes the brand for the order: the
 *   discount D of a takeAway promo (docs/takeaway-promos.md) plus the loyalty
 *   points spent. Both are takeAway's to fund; 0 once the order was cancelled
 *   or expired (the promo and the points went back).
 * - **Commission base** = card money captured − refunded + compensation: the
 *   order at the price the brand would have got without takeAway's discounts.
 *   The brand's own promo codes and gift cards stay outside it, and so does
 *   an order with no card payment (paid at the counter, if at all).
 * - **Commission** = base × rate, in whole cents, rounded half up, per order.
 *   Rounding each order (not the day or the period) is what makes days add
 *   up to the period and periods to the year exactly.
 * - **Net** = commission − compensation: positive, the brand owes takeAway;
 *   negative, takeAway owes the brand. A period is closed by one settlement
 *   of the net («взаимозачёт»).
 */

export const BPS_DENOMINATOR = 10_000;

/** One order as the settlement query reads it. */
export interface SettlementOrderRow {
  id: string;
  settledAt: Date;
  /** Line items before any discount. */
  subtotalCents: number;
  /** Promo and points together, as the order stores them (a takeAway promo's D included). */
  discountCents: number;
  pointsDiscountCents: number;
  /** D of a takeAway promo as snapshotted on the order (part of `discountCents`). */
  takeawayDiscountCents: number;
  /**
   * What takeAway owes the brand for the order's takeAway promo: D of its
   * live redemption, 0 once the order was cancelled or expired (the
   * redemption is gone then) or without a takeAway promo.
   */
  takeawayCompensationCents: number;
  /**
   * What takeAway owes the brand for the loyalty points spent on the order:
   * `pointsDiscountCents`, 0 once the order was cancelled or expired.
   */
  pointsCompensationCents: number;
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
    cardNetCents: 0,
    takeawayCompensationCents: 0,
    pointsCompensationCents: 0,
    compensationCents: 0,
    commissionBaseCents: 0,
    commissionCents: 0,
    netCents: 0,
  };
}

/** One order's contribution to every figure, at the rate in force when it settled. */
export function settleOrder(row: SettlementOrderRow, bps: number): SettlementTotals {
  const captured = row.hasCapture ? Math.max(0, row.capturedCents) : 0;
  // A refund never exceeds what was taken; clamp so base stays captured − refunded.
  const refunded = row.hasCapture ? Math.min(captured, Math.max(0, row.refundedCents)) : 0;
  const promoCompensation = Math.max(0, row.takeawayCompensationCents);
  const pointsCompensation = Math.max(0, row.pointsCompensationCents);
  const compensation = promoCompensation + pointsCompensation;
  const cardNet = captured - refunded;
  const base = cardNet + compensation;
  const commission = commissionCents(base, bps);
  const unpaid = !row.hasCapture && row.totalCents > 0;
  return {
    orders: 1,
    cardOrders: row.hasCapture ? 1 : 0,
    zeroTotalOrders: !row.hasCapture && row.totalCents <= 0 ? 1 : 0,
    unpaidOrders: unpaid ? 1 : 0,
    unpaidTotalCents: unpaid ? row.totalCents : 0,
    salesCents: row.subtotalCents,
    promoDiscountCents: Math.max(0, row.discountCents - row.pointsDiscountCents - row.takeawayDiscountCents),
    pointsDiscountCents: row.pointsDiscountCents,
    giftCardCents: row.giftCardCents,
    deliveryFeeCents: row.deliveryFeeCents,
    capturedCents: captured,
    refundedCents: refunded,
    cardNetCents: cardNet,
    takeawayCompensationCents: promoCompensation,
    pointsCompensationCents: pointsCompensation,
    compensationCents: compensation,
    commissionBaseCents: base,
    commissionCents: commission,
    netCents: commission - compensation,
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
  /** Net of every order settled before the period: the opening side of the balance. */
  accruedBeforeCents: number;
  /** Net of every order settled before the period ends. */
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
    accruedBeforeEnd += settled.netCents;
    if (!firstSettledAt || row.settledAt < firstSettledAt) firstSettledAt = row.settledAt;
    if (row.settledAt.getTime() < window.start.getTime()) {
      accruedBefore += settled.netCents;
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

/** The figures a settlement keeps for its period. */
export interface PeriodFigures {
  /** Card money only (captured − refunded), without the compensation. */
  cardNetCents: number;
  /** takeAway promo compensation. */
  compensationCents: number;
  /** Loyalty points compensation. */
  pointsCompensationCents: number;
  commissionCents: number;
}

/** The card money, compensation and commission of the orders settled within [start, end). */
export function periodFigures(
  rows: readonly SettlementOrderRow[],
  timeline: readonly RatePoint[],
  fallbackBps: number,
  start: Date,
  end: Date,
): PeriodFigures {
  const figures: PeriodFigures = {
    cardNetCents: 0,
    compensationCents: 0,
    pointsCompensationCents: 0,
    commissionCents: 0,
  };
  for (const row of rows) {
    const t = row.settledAt.getTime();
    if (t < start.getTime() || t >= end.getTime()) continue;
    const settled = settleOrder(row, rateAt(timeline, row.settledAt, fallbackBps));
    figures.cardNetCents += settled.cardNetCents;
    figures.compensationCents += settled.takeawayCompensationCents;
    figures.pointsCompensationCents += settled.pointsCompensationCents;
    figures.commissionCents += settled.commissionCents;
  }
  return figures;
}

/** What the balance needs to know about a settlement. */
export interface LedgerPayout {
  /** The instant the period it covers ends at. */
  periodEnd: Date;
  /** Last local day it covers. */
  periodTo: string;
  /** Signed: positive when the brand pays takeAway, negative when takeAway pays the brand. */
  signedCents: number;
  status: PayoutStatus;
}

/** A settlement's amount with the sign of the balance: + the brand pays, − takeAway pays. */
export function signedAmount(direction: SettlementDirection, amountCents: number): number {
  return direction === 'BRAND_TO_TAKEAWAY' ? amountCents : -amountCents;
}

/** Who pays a signed net, and how much. Zero has no direction. */
export function directionOf(netCents: number): { direction: SettlementDirection | null; amountCents: number } {
  if (netCents > 0) return { direction: 'BRAND_TO_TAKEAWAY', amountCents: netCents };
  if (netCents < 0) return { direction: 'TAKEAWAY_TO_BRAND', amountCents: -netCents };
  return { direction: null, amountCents: 0 };
}

/**
 * The balance around a period, signed (+ the brand owes takeAway). "Owed at
 * t" is the net of every order settled before t minus the settlements
 * *confirmed* for periods ending by t — one fixed or paid but not confirmed
 * by the receiver is still owed.
 */
export function settlementBalance(input: {
  accruedBeforeCents: number;
  netCents: number;
  payouts: readonly LedgerPayout[];
  start: Date;
  end: Date;
}): SettlementBalance {
  const start = input.start.getTime();
  const end = input.end.getTime();
  let settledBefore = 0;
  let settledIn = 0;
  let openIn = 0;
  let openByEnd = 0;
  for (const p of input.payouts) {
    const t = p.periodEnd.getTime();
    if (t > end) continue;
    const confirmed = p.status === 'CONFIRMED';
    if (!confirmed) openByEnd += p.signedCents;
    if (t <= start) {
      if (confirmed) settledBefore += p.signedCents;
    } else if (confirmed) {
      settledIn += p.signedCents;
    } else {
      openIn += p.signedCents;
    }
  }
  const opening = input.accruedBeforeCents - settledBefore;
  return {
    openingCents: opening,
    netCents: input.netCents,
    settledCents: settledIn,
    openCents: openIn,
    closingCents: opening + input.netCents - settledIn,
    closingOpenCents: openByEnd,
  };
}

/**
 * The settlement «Зафиксировать взаиморасчёт» would create for the period
 * ending on `to`. Settlements follow each other: the new one starts the day
 * after the last one (or on the first counted order) and takes the whole
 * balance at the end of `to` not fixed before — refunds and rate corrections
 * that came in after earlier settlements included — whichever way it points.
 */
export function planPayout(input: {
  to: string;
  today: string;
  lastSettledDay: string | null;
  firstSettledDay: string | null;
  accruedBeforeEndCents: number;
  /** Every settlement fixed so far, signed, confirmed or not. */
  committedCents: number;
  nextDay: (day: string) => string;
}): {
  periodFrom: string | null;
  netCents: number;
  direction: SettlementDirection | null;
  amountCents: number;
  blocked: PayoutBlockReason | null;
} {
  const net = input.accruedBeforeEndCents - input.committedCents;
  const { direction, amountCents } = directionOf(net);
  const periodFrom = input.lastSettledDay ? input.nextDay(input.lastSettledDay) : input.firstSettledDay;
  let blocked: PayoutBlockReason | null = null;
  if (input.lastSettledDay && input.to <= input.lastSettledDay) blocked = 'OVERLAP';
  else if (input.to >= input.today) blocked = 'PERIOD_OPEN';
  else if (direction === null || periodFrom === null) blocked = 'NOTHING_DUE';
  return { periodFrom, netCents: net, direction, amountCents, blocked };
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
