import type { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import type {
  BrandTakeawayPromoOrder,
  TakeawayDebtReport,
  TakeawayDebtRow,
  TakeawayDebtStatus,
  TakeawayPromoBrandRow,
  TakeawayPromoDayRow,
  TakeawayPromoReport,
  TakeawayPromoStoreRow,
} from '@takeaway/shared-types';
import { takeawayDebtStatus } from '@takeaway/utils';

/**
 * takeAway's debt to the venues for its promos (docs/takeaway-promos.md
 * §2.8), read the one way every report reads it — the platform's promo
 * report and debt report, and the brand cabinet — so the figures always
 * agree.
 *
 * A promo order is a debt once it *counts*, exactly as settlements count an
 * order (`SettlementsService.orderRows`): accepted by the store, or a card
 * payment for it captured — and not cancelled or expired. Its moment is the
 * accept, or else the first capture. A cancelled or expired order has no
 * redemption at all (it gave its share of the budget back); one still
 * waiting for its payment holds the budget but owes nothing yet.
 */

/** Payment states in which the money reached the platform — settlements' list. */
const CAPTURED: PaymentStatus[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const NEVER_COUNTS: OrderStatus[] = ['CANCELLED', 'EXPIRED'];

export const COUNTED_REDEMPTION_SELECT = {
  id: true,
  orderId: true,
  promoId: true,
  userId: true,
  brandId: true,
  storeId: true,
  currency: true,
  code: true,
  percent: true,
  menuTotalCents: true,
  discountCents: true,
  payoutId: true,
  promo: { select: { name: true } },
  payout: { select: { status: true, confirmedAt: true } },
  order: {
    select: {
      orderCode: true,
      status: true,
      acceptedAt: true,
      currency: true,
      store: { select: { name: true, brand: { select: { name: true } } } },
      payments: { where: { status: { in: CAPTURED } }, select: { createdAt: true, currency: true } },
    },
  },
} satisfies Prisma.TakeawayPromoRedemptionSelect;

type RedemptionRead = Prisma.TakeawayPromoRedemptionGetPayload<{ select: typeof COUNTED_REDEMPTION_SELECT }>;

/** One promo order that counts, with where its compensation stands. */
export interface CountedRedemption {
  id: string;
  orderId: string;
  orderCode: string;
  promoId: string;
  promoName: string;
  userId: string;
  brandId: string;
  brandName: string;
  storeId: string;
  storeName: string;
  currency: string;
  code: string;
  percent: number;
  /** P. */
  menuTotalCents: number;
  /** D — the compensation. */
  discountCents: number;
  payoutId: string | null;
  /** When the order counted (accepted, or first captured). */
  settledAt: Date;
  status: TakeawayDebtStatus;
  /** REPAID: when the brand confirmed the settlement. */
  repaidAt: Date | null;
}

type Db = Pick<Prisma.TransactionClient, 'takeawayPromoRedemption'>;

/**
 * When the order counted — the accept, or else its first captured payment in
 * the order's currency — or null while it does not count (yet).
 */
export function countedAt(order: {
  status: OrderStatus;
  acceptedAt: Date | null;
  currency: string;
  payments: ReadonlyArray<{ createdAt: Date; currency: string }>;
}): Date | null {
  if (NEVER_COUNTS.includes(order.status)) return null;
  if (order.acceptedAt) return order.acceptedAt;
  let first: Date | null = null;
  for (const p of order.payments) {
    if (p.currency !== order.currency) continue;
    if (!first || p.createdAt < first) first = p.createdAt;
  }
  return first;
}

export function toCountedRedemption(row: RedemptionRead): CountedRedemption | null {
  const settledAt = countedAt(row.order);
  if (!settledAt) return null;
  const status = takeawayDebtStatus(row.payout);
  return {
    id: row.id,
    orderId: row.orderId,
    orderCode: row.order.orderCode,
    promoId: row.promoId,
    promoName: row.promo.name,
    userId: row.userId,
    brandId: row.brandId,
    brandName: row.order.store.brand.name,
    storeId: row.storeId,
    storeName: row.order.store.name,
    currency: row.currency,
    code: row.code,
    percent: row.percent,
    menuTotalCents: row.menuTotalCents,
    discountCents: row.discountCents,
    payoutId: row.payoutId,
    settledAt,
    status,
    repaidAt: status === 'REPAID' ? (row.payout?.confirmedAt ?? null) : null,
  };
}

/** Every promo order matching `where` that counts, oldest first. */
export async function countedRedemptions(
  db: Db,
  where: Prisma.TakeawayPromoRedemptionWhereInput = {},
): Promise<CountedRedemption[]> {
  const rows = await db.takeawayPromoRedemption.findMany({
    where: { AND: [where, { order: { status: { notIn: NEVER_COUNTS } } }] },
    select: COUNTED_REDEMPTION_SELECT,
  });
  return rows
    .map(toCountedRedemption)
    .filter((r): r is CountedRedemption => r !== null)
    .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
}

export interface DebtFigures {
  /** Σ D of counted promo orders. */
  accruedCents: number;
  /** Of it, in payouts fixed but not paid yet. */
  inPayoutCents: number;
  /** Of it, in payouts marked paid. */
  repaidCents: number;
  /** accrued − repaid: what takeAway owes now. */
  debtCents: number;
}

export function debtFigures(rows: Iterable<Pick<CountedRedemption, 'discountCents' | 'status'>>): DebtFigures {
  let accruedCents = 0;
  let inPayoutCents = 0;
  let repaidCents = 0;
  for (const r of rows) {
    accruedCents += r.discountCents;
    if (r.status === 'IN_PAYOUT') inPayoutCents += r.discountCents;
    if (r.status === 'REPAID') repaidCents += r.discountCents;
  }
  return { accruedCents, inPayoutCents, repaidCents, debtCents: accruedCents - repaidCents };
}

/** `GET /admin/takeaway-promos/debt`: one row per brand and currency, totals per currency. */
export function debtReport(rows: readonly CountedRedemption[]): TakeawayDebtReport {
  const groups = new Map<string, CountedRedemption[]>();
  for (const r of rows) {
    const key = `${r.brandId}\u0000${r.currency}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const debtRows: TakeawayDebtRow[] = [...groups.values()]
    .map((list) => {
      const first = list[0] as CountedRedemption;
      return { brandId: first.brandId, brandName: first.brandName, currency: first.currency, ...debtFigures(list) };
    })
    .sort((a, b) => a.brandName.localeCompare(b.brandName, 'ru') || a.currency.localeCompare(b.currency));

  const totals = new Map<string, TakeawayDebtReport['totals'][number]>();
  for (const row of debtRows) {
    const t = totals.get(row.currency) ?? {
      currency: row.currency,
      accruedCents: 0,
      repaidCents: 0,
      inPayoutCents: 0,
      debtCents: 0,
    };
    t.accruedCents += row.accruedCents;
    t.repaidCents += row.repaidCents;
    t.inPayoutCents += row.inPayoutCents;
    t.debtCents += row.debtCents;
    totals.set(row.currency, t);
  }
  return { rows: debtRows, totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)) };
}

/** `GET /admin/takeaway-promos/:id/report` without the promo itself: by brand, store and UTC day. */
export function promoReportFigures(rows: readonly CountedRedemption[]): Omit<TakeawayPromoReport, 'promo'> {
  const byBrand = new Map<string, TakeawayPromoBrandRow>();
  const byStore = new Map<string, TakeawayPromoStoreRow>();
  const byDay = new Map<string, TakeawayPromoDayRow>();
  const customers = new Set<string>();
  let menuTotalCents = 0;
  let discountCents = 0;
  for (const r of rows) {
    customers.add(r.userId);
    menuTotalCents += r.menuTotalCents;
    discountCents += r.discountCents;

    const brand = byBrand.get(r.brandId) ?? {
      brandId: r.brandId,
      brandName: r.brandName,
      orders: 0,
      menuTotalCents: 0,
      discountCents: 0,
    };
    brand.orders += 1;
    brand.menuTotalCents += r.menuTotalCents;
    brand.discountCents += r.discountCents;
    byBrand.set(r.brandId, brand);

    const store = byStore.get(r.storeId) ?? {
      brandId: r.brandId,
      brandName: r.brandName,
      storeId: r.storeId,
      storeName: r.storeName,
      orders: 0,
      menuTotalCents: 0,
      discountCents: 0,
    };
    store.orders += 1;
    store.menuTotalCents += r.menuTotalCents;
    store.discountCents += r.discountCents;
    byStore.set(r.storeId, store);

    const date = r.settledAt.toISOString().slice(0, 10);
    const day = byDay.get(date) ?? { date, orders: 0, discountCents: 0 };
    day.orders += 1;
    day.discountCents += r.discountCents;
    byDay.set(date, day);
  }
  const largestFirst = <T extends { discountCents: number }>(a: T, b: T) => b.discountCents - a.discountCents;
  return {
    orders: rows.length,
    customers: customers.size,
    menuTotalCents,
    discountCents,
    byBrand: [...byBrand.values()].sort(largestFirst),
    byStore: [...byStore.values()].sort(largestFirst),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * The brand cabinet's «Акции takeAway» (§4.2) over one brand's counted promo
 * orders in one currency: the period's summary and list, and the debt now —
 * the same `debtFigures` as the brand's row of the platform debt report.
 */
export function brandPromoSummary(
  rows: readonly CountedRedemption[],
  period: { start: Date; end: Date },
): {
  orders: number;
  menuTotalCents: number;
  paidByGuestCents: number;
  compensationAccruedCents: number;
  compensationRepaidCents: number;
  currentDebtCents: number;
  items: BrandTakeawayPromoOrder[];
} {
  const inPeriod = rows.filter((r) => r.settledAt >= period.start && r.settledAt < period.end);
  const figures = debtFigures(inPeriod);
  const menuTotalCents = inPeriod.reduce((sum, r) => sum + r.menuTotalCents, 0);
  return {
    orders: inPeriod.length,
    menuTotalCents,
    paidByGuestCents: menuTotalCents - figures.accruedCents,
    compensationAccruedCents: figures.accruedCents,
    compensationRepaidCents: figures.repaidCents,
    currentDebtCents: debtFigures(rows).debtCents,
    items: [...inPeriod]
      .sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime())
      .map((r) => ({
        orderId: r.orderId,
        orderCode: r.orderCode,
        storeId: r.storeId,
        storeName: r.storeName,
        settledAt: r.settledAt.toISOString(),
        promoName: r.promoName,
        percent: r.percent,
        menuTotalCents: r.menuTotalCents,
        paidByGuestCents: r.menuTotalCents - r.discountCents,
        compensationCents: r.discountCents,
        status: r.status,
        payoutId: r.payoutId,
        repaidAt: r.repaidAt?.toISOString() ?? null,
      })),
  };
}
