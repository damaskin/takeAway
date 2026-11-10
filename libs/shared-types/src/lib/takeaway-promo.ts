/**
 * «Акции takeAway» — percent discounts takeAway runs at every venue at its
 * own expense, and the welcome bonus built on them. The rules, the API and
 * the screens: docs/takeaway-promos.md. The money arithmetic lives in
 * `@takeaway/utils` (takeaway-promo.ts).
 *
 * All amounts are integer minor units (cents / kopecks / bani) of the
 * promo's `currency`.
 */

/** What the platform admin set: running, switched off, or out of budget (set by the API). */
export type TakeawayPromoStatus = 'ACTIVE' | 'DISABLED' | 'EXHAUSTED';

/**
 * What the promo does now: an ACTIVE promo before its start is SCHEDULED,
 * after its end ENDED; DISABLED and EXHAUSTED stay as they are.
 */
export type TakeawayPromoEffectiveStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'DISABLED' | 'EXHAUSTED';

export function takeawayPromoEffectiveStatus(
  promo: { status: TakeawayPromoStatus; startsAt: string | Date; endsAt: string | Date },
  now: Date = new Date(),
): TakeawayPromoEffectiveStatus {
  if (promo.status !== 'ACTIVE') return promo.status;
  const t = now.getTime();
  if (t < new Date(promo.startsAt).getTime()) return 'SCHEDULED';
  if (t > new Date(promo.endsAt).getTime()) return 'ENDED';
  return 'ACTIVE';
}

/** `GET /admin/takeaway-promos` row and the answer of every write. */
export interface TakeawayPromo {
  id: string;
  /** «Приветственный бонус». */
  name: string;
  /** The code a customer types, uppercase. Unique across takeAway promos and brand promo codes. */
  code: string;
  /** 1..99. Frozen once the promo was used. */
  percent: number;
  startsAt: string;
  endsAt: string;
  /** The budget's currency; the promo works at stores selling in it. */
  currency: string;
  budgetCents: number;
  /** Discounts of orders that hold the promo (placed, paid or done; a cancelled order gives its share back). */
  spentCents: number;
  /** budget − spent. */
  leftCents: number;
  status: TakeawayPromoStatus;
  effectiveStatus: TakeawayPromoEffectiveStatus;
  /** Handed out automatically on sign-up. At most one ACTIVE welcome promo at a time. */
  isWelcome: boolean;
  /** Orders holding the promo. */
  redemptionsCount: number;
  /** Nobody used it yet: every field may change. After that — name, end, budget (up only) and status. */
  editable: boolean;
  createdAt: string;
}

/** `POST /admin/takeaway-promos`. */
export interface CreateTakeawayPromoInput {
  name: string;
  code: string;
  percent: number;
  startsAt: string;
  endsAt: string;
  currency: string;
  budgetCents: number;
  isWelcome?: boolean;
}

/**
 * `PATCH /admin/takeaway-promos/:id`. Before the first use everything may
 * change; after it only `name`, `endsAt` and `budgetCents` (never below what
 * was spent), otherwise 409 TAKEAWAY_PROMO_USED.
 */
export type UpdateTakeawayPromoInput = Partial<CreateTakeawayPromoInput>;

/** `PATCH /admin/takeaway-promos/:id/status` — switch off, or back on (EXHAUSTED only once the budget has room). */
export interface UpdateTakeawayPromoStatusInput {
  status: 'ACTIVE' | 'DISABLED';
}

/** Stable codes on the admin's 400/409 answers. */
export type TakeawayPromoAdminErrorCode =
  | 'TAKEAWAY_PROMO_CODE_TAKEN'
  | 'TAKEAWAY_PROMO_USED'
  | 'TAKEAWAY_PROMO_DATES'
  | 'TAKEAWAY_PROMO_PERCENT'
  | 'TAKEAWAY_PROMO_BUDGET'
  | 'TAKEAWAY_PROMO_WELCOME_TAKEN'
  | 'TAKEAWAY_PROMO_STATUS';

/** One brand's share of a promo, `GET /admin/takeaway-promos/:id/report`. */
export interface TakeawayPromoBrandRow {
  brandId: string;
  brandName: string;
  orders: number;
  /** Σ P. */
  menuTotalCents: number;
  /** Σ D — what takeAway owes this brand for the promo. */
  discountCents: number;
}

export interface TakeawayPromoStoreRow extends TakeawayPromoBrandRow {
  storeId: string;
  storeName: string;
}

export interface TakeawayPromoDayRow {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  orders: number;
  discountCents: number;
}

/** `GET /admin/takeaway-promos/:id/report` — counted orders only (paid or accepted, not cancelled). */
export interface TakeawayPromoReport {
  promo: TakeawayPromo;
  orders: number;
  customers: number;
  menuTotalCents: number;
  discountCents: number;
  byBrand: TakeawayPromoBrandRow[];
  byStore: TakeawayPromoStoreRow[];
  /** Every day with an order, oldest first. */
  byDay: TakeawayPromoDayRow[];
}

/** One brand of `GET /admin/takeaway-promos/debt`. */
export interface TakeawayDebtRow {
  brandId: string;
  brandName: string;
  currency: string;
  /** Σ D of counted promo orders. */
  accruedCents: number;
  /** Of it, in payouts already marked paid. */
  repaidCents: number;
  /** Of it, in payouts fixed but not transferred yet. */
  inPayoutCents: number;
  /** What takeAway owes the brand now: accrued − repaid. */
  debtCents: number;
}

/** `GET /admin/takeaway-promos/debt` — takeAway's debt to every brand, now. */
export interface TakeawayDebtReport {
  rows: TakeawayDebtRow[];
  /** Per currency: the sum of the rows (never summed across currencies). */
  totals: Array<{
    currency: string;
    accruedCents: number;
    repaidCents: number;
    inPayoutCents: number;
    debtCents: number;
  }>;
}

/** Where one promo order's compensation stands. */
export type TakeawayDebtStatus = 'ACCRUED' | 'IN_PAYOUT' | 'REPAID';

/** One order of the brand cabinet's list. */
export interface BrandTakeawayPromoOrder {
  orderId: string;
  orderCode: string;
  storeId: string;
  storeName: string;
  /** When the order counted (accepted, or first captured). */
  settledAt: string;
  promoName: string;
  percent: number;
  menuTotalCents: number;
  paidByGuestCents: number;
  compensationCents: number;
  status: TakeawayDebtStatus;
  payoutId: string | null;
  /** REPAID: when the payout was marked paid. */
  repaidAt: string | null;
}

/**
 * `GET /admin/settlements/takeaway-promos?brandId&currency&from&to` — the
 * brand cabinet's «Взаиморасчёты по акциям takeAway». The summary and the
 * list cover the period (local days of the brand); `currentDebtCents` is
 * always now.
 */
export interface BrandTakeawayPromoReport {
  brandId: string;
  currency: string;
  period: { from: string; to: string; timeZone: string };
  orders: number;
  menuTotalCents: number;
  paidByGuestCents: number;
  compensationAccruedCents: number;
  compensationRepaidCents: number;
  /** accrued − repaid over all time, now — the same figure as the brand's row in the platform debt report. */
  currentDebtCents: number;
  /** Newest first. */
  items: BrandTakeawayPromoOrder[];
}

/**
 * A takeAway promo on one order, for the order card in the admin, the
 * kitchen board and the customer's receipt: «Акция takeAway −10%: гость
 * оплатил 90,00, ещё 10,00 компенсирует takeAway».
 */
export interface TakeawayPromoLine {
  code: string;
  name: string;
  percent: number;
  menuTotalCents: number;
  discountCents: number;
  paidByGuestCents: number;
}

/** `GET /me/bonuses` — the customer's unused welcome bonus, if any. */
export interface CustomerBonus {
  id: string;
  kind: 'WELCOME';
  promoId: string;
  /** Put into the promo field at checkout; the API checks it belongs to this customer. */
  code: string;
  name: string;
  percent: number;
  currency: string;
  expiresAt: string;
}
