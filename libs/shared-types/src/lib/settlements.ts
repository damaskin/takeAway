/**
 * Settlements with brands: `GET /admin/settlements` and its neighbours.
 *
 * Since 2026-11-14 a guest pays the brand directly — takeAway does not hold
 * the brand's money and pays nothing out of it. Two debts meet instead:
 *
 * - the brand owes takeAway its **commission**, taken on the order's full
 *   price (card money + what takeAway compensates);
 * - takeAway owes the brand **compensation** for the discounts it funds:
 *   its own promos («Акции takeAway») and loyalty points spent.
 *
 * A period is closed by one netted sum («взаимозачёт»): commission −
 * compensation. Positive — the brand pays takeAway; negative — takeAway pays
 * the brand. The payer marks it paid, the other side confirms «получено».
 *
 * One report covers one brand, one currency (never summed across currencies)
 * and a period of calendar days in the brand's time zone. Definitions and a
 * worked example: docs/settlements.md.
 *
 * All amounts are integer minor units (cents / kopecks). A signed amount is
 * positive when the brand owes takeAway and negative when takeAway owes the
 * brand.
 */

import type { BrandPlan } from './plan';

/** Why a settlement cannot be fixed for the period on screen. */
export type PayoutBlockReason =
  /** The last day has not ended yet in the brand's time zone. */
  | 'PERIOD_OPEN'
  /** An earlier settlement already covers that day. */
  | 'OVERLAP'
  /** Commission and compensation cancel out: nobody owes anything. */
  | 'NOTHING_DUE';

/** Who pays whom when a period is settled. */
export type SettlementDirection =
  /** Commission exceeds compensation: the brand pays takeAway. */
  | 'BRAND_TO_TAKEAWAY'
  /** Compensation exceeds commission: takeAway pays the brand. */
  | 'TAKEAWAY_TO_BRAND';

/** A side of a settlement. */
export type SettlementSide = 'TAKEAWAY' | 'BRAND';

/**
 * - `PENDING` — fixed by the platform admin, not paid yet («ждёт оплаты»);
 * - `PAID` — the payer says the money went out («оплачено, ждёт подтверждения»);
 * - `CONFIRMED` — the receiver confirmed it arrived («получено»), final;
 * - `DISPUTED` — the receiver says it did not arrive («не получено»).
 *
 * Only a confirmed settlement reduces the balance.
 */
export type PayoutStatus = 'PENDING' | 'PAID' | 'CONFIRMED' | 'DISPUTED';

export type CommissionRateSource = 'PLAN' | 'INDIVIDUAL';

/** Figures of a day or of the whole period. */
export interface SettlementTotals {
  /** Orders that count: a card payment was captured, or the store accepted the order. */
  orders: number;
  /** Of them, orders paid by card (or the mobile payment). */
  cardOrders: number;
  /** Accepted orders with nothing to pay — promo, points or a gift card covered all of it. */
  zeroTotalOrders: number;
  /** Accepted orders with something to pay but no card payment (paid at the counter, if at all). */
  unpaidOrders: number;
  /** What those unpaid orders came to. No commission is taken on them. */
  unpaidTotalCents: number;
  /** «Продажи»: line items before any discount. */
  salesCents: number;
  /** Discounts of the brand's own promo codes (the brand pays for them). */
  promoDiscountCents: number;
  /** Loyalty points spent (as the orders recorded them, cancelled ones included). */
  pointsDiscountCents: number;
  /** Gift-card balance redeemed — money the brand already took when it sold the card. */
  giftCardCents: number;
  /** Delivery fees charged to customers (part of the card money). */
  deliveryFeeCents: number;
  /** Card money guests paid (to the brand). */
  capturedCents: number;
  /** Of it, given back to guests. */
  refundedCents: number;
  /** «Всего оплачено картами»: captured − refunded. */
  cardNetCents: number;
  /**
   * «Компенсация takeAway по акциям»: the discounts of takeAway promos on
   * these orders (Σ D). 0 for a cancelled or expired order.
   */
  takeawayCompensationCents: number;
  /**
   * «Компенсация takeAway по баллам»: loyalty points spent on these orders —
   * takeAway funds the loyalty programme. 0 for a cancelled or expired order.
   */
  pointsCompensationCents: number;
  /** What takeAway owes the brand: promo + points compensation. */
  compensationCents: number;
  /**
   * Commission base: card net + compensation — the commission of an order
   * with takeAway's promo or points is taken on its full price.
   */
  commissionBaseCents: number;
  /** «Комиссия takeAway», rounded per order (half up). */
  commissionCents: number;
  /**
   * «К взаиморасчёту»: commission − compensation. Positive — the brand owes
   * takeAway; negative — takeAway owes the brand.
   */
  netCents: number;
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
 * What is owed around a period, signed (positive — the brand owes takeAway).
 * Settlements are matched on the end of the period they cover, not on the day
 * the money moved.
 *
 * closing = opening + net − settled
 */
export interface SettlementBalance {
  /** Owed when the period opened. */
  openingCents: number;
  /** The period's own net (= totals.netCents). */
  netCents: number;
  /** Confirmed settlements for periods that end inside this one. */
  settledCents: number;
  /** Settlements fixed for periods that end inside this one, not confirmed yet. */
  openCents: number;
  /** «Остаток»: still owed when the period closes, fixed or not. */
  closingCents: number;
  /** Of the closing balance, already fixed in settlements not confirmed yet. */
  closingOpenCents: number;
}

/** What «Зафиксировать взаиморасчёт» would create for the period on screen. */
export interface SettlementPayoutPreview {
  /** Picks up the day after the last settlement (or at the first settled order). */
  periodFrom: string | null;
  periodTo: string;
  /** Who would pay; null when nothing is owed. */
  direction: SettlementDirection | null;
  /** What would be paid, never negative. */
  amountCents: number;
  /** The same, signed: the balance at the end of `periodTo` not fixed yet. */
  netCents: number;
  /** The period's own figures. */
  cardNetCents: number;
  commissionCents: number;
  /** takeAway promo compensation (the promo debts this settlement covers). */
  compensationCents: number;
  /** Loyalty points compensation. */
  pointsCompensationCents: number;
  blocked: PayoutBlockReason | null;
  /** Last day already covered by a settlement, if any. */
  lastSettledDay: string | null;
}

/** One period's settlement («взаиморасчёт»). The API keeps the old `payout` names. */
export interface SettlementPayout {
  id: string;
  brandId: string;
  currency: string;
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  direction: SettlementDirection;
  /** What the payer pays, never negative. */
  amountCents: number;
  /** The period's figures as they were when it was fixed. */
  cardNetCents: number;
  commissionCents: number;
  /** «Компенсация takeAway по акциям» of the period. */
  compensationCents: number;
  /** «Компенсация takeAway по баллам» of the period. */
  pointsCompensationCents: number;
  status: PayoutStatus;
  /** When the payer said the money went out. */
  paidAt: string | null;
  /** When the receiver confirmed it arrived. */
  confirmedAt: string | null;
  /** When the receiver said it did not arrive (cleared once paid again). */
  disputedAt: string | null;
  /** The receiver's words on a dispute. */
  disputeComment: string | null;
  /** Bank transfer number or any other handle on the payment. */
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
  /** Every settlement in this currency, newest period first. */
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

/** `PATCH /admin/settlements/payouts/:id/paid` — the payer says the money went out. */
export interface MarkSettlementPaidInput {
  reference?: string;
  comment?: string;
  /** When it went out; now when omitted. */
  paidAt?: string;
}

/** `PATCH /admin/settlements/payouts/:id/confirm` — the receiver's answer. */
export interface ConfirmSettlementInput {
  /** true — «получено»; false — «не получено» (only after the payer marked it paid). */
  received: boolean;
  /** Why it was not received; kept on the settlement. */
  comment?: string;
}

/** The side that pays a settlement in `direction`. */
export function settlementPayer(direction: SettlementDirection): SettlementSide {
  return direction === 'BRAND_TO_TAKEAWAY' ? 'BRAND' : 'TAKEAWAY';
}

/** The side that receives a settlement in `direction`. */
export function settlementReceiver(direction: SettlementDirection): SettlementSide {
  return direction === 'BRAND_TO_TAKEAWAY' ? 'TAKEAWAY' : 'BRAND';
}

/** What a side may do with a settlement now. The API enforces the same rules. */
export interface SettlementActions {
  /** «Отметить оплату»: the payer, while it is pending or disputed. */
  markPaid: boolean;
  /** «Получено»: the receiver, until it is confirmed. */
  confirm: boolean;
  /** «Не получено»: the receiver, once the payer marked it paid. */
  dispute: boolean;
}

export function settlementActions(
  payout: Pick<SettlementPayout, 'direction' | 'status'>,
  side: SettlementSide,
): SettlementActions {
  const payer = settlementPayer(payout.direction) === side;
  const receiver = settlementReceiver(payout.direction) === side;
  return {
    markPaid: payer && (payout.status === 'PENDING' || payout.status === 'DISPUTED'),
    confirm: receiver && payout.status !== 'CONFIRMED',
    dispute: receiver && payout.status === 'PAID',
  };
}

/** Error codes of the settlement routes (409 unless noted). */
export type SettlementErrorCode =
  | 'PAYOUT_OVERLAP'
  | 'PAYOUT_PERIOD_OPEN'
  | 'PAYOUT_NOTHING_DUE'
  /** The settlement is not in a state that allows this step. */
  | 'PAYOUT_STATUS'
  /** 403: the other side takes this step. */
  | 'PAYOUT_NOT_YOUR_SIDE'
  /** Only a pending settlement can be removed. */
  | 'PAYOUT_PAID'
  | 'PAYOUT_NOT_LATEST';
