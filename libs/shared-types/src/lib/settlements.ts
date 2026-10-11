/**
 * Settlements with brands: `GET /admin/settlements` and its neighbours.
 *
 * Customers pay by card through the platform's acquiring, so the platform
 * holds the money and pays each brand out minus its commission. One report
 * covers one brand, one currency (never summed across currencies) and a
 * period of calendar days in the brand's time zone. Definitions and a worked
 * example: docs/settlements.md.
 *
 * All amounts are integer minor units (cents / kopecks).
 */

import type { BrandPlan } from './plan';

/** Why a payout cannot be fixed for the period on screen. */
export type PayoutBlockReason =
  /** The last day has not ended yet in the brand's time zone. */
  | 'PERIOD_OPEN'
  /** An earlier payout already settles that day. */
  | 'OVERLAP'
  /** Nothing is owed at the end of the period (a negative balance is carried forward). */
  | 'NOTHING_DUE';

export type PayoutStatus = 'PENDING' | 'PAID';

export type CommissionRateSource = 'PLAN' | 'INDIVIDUAL';

/** Figures of a day or of the whole period. */
export interface SettlementTotals {
  /** Orders that count: a card payment was captured, or the store accepted the order. */
  orders: number;
  /** Of them, orders with card money captured by the platform. */
  cardOrders: number;
  /** Accepted orders with nothing to pay — promo, points or a gift card covered all of it. */
  zeroTotalOrders: number;
  /** Accepted orders with something to pay but no card payment through the platform. */
  unpaidOrders: number;
  /** What those unpaid orders came to — money the brand took itself, if at all. */
  unpaidTotalCents: number;
  /** «Продажи»: line items before any discount. */
  salesCents: number;
  /** Promo-code discounts. */
  promoDiscountCents: number;
  /** Loyalty points spent. */
  pointsDiscountCents: number;
  /** Gift-card balance redeemed — money the brand already took when it sold the card. */
  giftCardCents: number;
  /** Delivery fees charged to customers (part of the card money). */
  deliveryFeeCents: number;
  /** Card money the platform captured. */
  capturedCents: number;
  /** Of it, given back to customers. */
  refundedCents: number;
  /** Commission base: captured − refunded. */
  commissionBaseCents: number;
  /** takeAway's commission, rounded per order (half up). */
  commissionCents: number;
  /** Owed to the brand for these orders: base − commission. */
  payableCents: number;
}

export interface SettlementDay extends SettlementTotals {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
}

/** One commission rate in force during part of the period, local days both included. */
export interface SettlementRateSpan {
  bps: number;
  source: CommissionRateSource;
  from: string;
  to: string;
}

/**
 * What is owed and what has been paid, around the period. Payouts are matched
 * on the end of the period they settle, not on the day the money went out.
 *
 * closing = opening + payable − paid
 */
export interface SettlementBalance {
  /** Owed to the brand when the period opened. Negative: the brand owes the platform. */
  openingCents: number;
  /** Earned by the brand during the period (= totals.payableCents). */
  payableCents: number;
  /** Paid out for periods that end inside this one. */
  paidCents: number;
  /** Fixed for periods that end inside this one, not transferred yet. */
  pendingCents: number;
  /** «Остаток»: still owed when the period closes, fixed or not. */
  closingCents: number;
  /** Of the closing balance, already fixed as pending payouts. */
  closingPendingCents: number;
}

/** What «Зафиксировать выплату» would create for the period on screen. */
export interface SettlementPayoutPreview {
  /** Picks up the day after the last payout (or at the first settled order). */
  periodFrom: string | null;
  periodTo: string;
  /** The balance owed at the end of `periodTo`. */
  amountCents: number;
  /** The period's own card money and commission. */
  cardNetCents: number;
  commissionCents: number;
  blocked: PayoutBlockReason | null;
  /** Last day already settled by a payout, if any. */
  lastSettledDay: string | null;
}

export interface SettlementPayout {
  id: string;
  brandId: string;
  currency: string;
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  amountCents: number;
  cardNetCents: number;
  commissionCents: number;
  status: PayoutStatus;
  paidAt: string | null;
  reference: string | null;
  comment: string | null;
  createdAt: string;
}

export interface SettlementReport {
  brand: {
    id: string;
    name: string;
    plan: BrandPlan;
    /** The rate in force now. */
    currentBps: number;
    /** The default rate of the brand's plan. */
    planBps: number;
  };
  currency: string;
  /** Every currency the brand has settled orders in, plus its own. */
  currencies: string[];
  period: { from: string; to: string; days: number; timeZone: string };
  totals: SettlementTotals;
  /** Every day of the period, empty days included. */
  days: SettlementDay[];
  /** The rates in force during the period, oldest first. */
  rates: SettlementRateSpan[];
  balance: SettlementBalance;
  nextPayout: SettlementPayoutPreview;
  /** Every payout in this currency, newest period first. */
  payouts: SettlementPayout[];
}

/** One row of a brand's commission history; `effectiveTo` is the next row's start. */
export interface CommissionRateEntry {
  id: string;
  bps: number;
  source: CommissionRateSource;
  /** UTC instants; `effectiveTo` null for the rate in force until further notice. */
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
}

export interface CommissionRateHistory {
  brandId: string;
  plan: BrandPlan;
  planBps: number;
  currentBps: number;
  timeZone: string;
  /** Oldest first. Empty when the brand has only ever had its plan's rate. */
  rates: CommissionRateEntry[];
}
