/**
 * The dashboards' one-request payloads: `GET /admin/analytics/overview`
 * (a business, its stores side by side) and `GET /admin/platform/overview`
 * (the platform, its businesses side by side). Both cover a period of
 * calendar days in one time zone and the period of the same length right
 * before it.
 *
 * Counting rules are the analytics module's: revenue, orders and customers
 * leave out cancelled and expired orders; `placed` counts every order.
 */

/** The days the figures cover and the days they are compared with, both ends included. */
export interface OverviewPeriod {
  from: string;
  to: string;
  days: number;
  timeZone: string;
  previousFrom: string;
  previousTo: string;
}

/** One period's figures. */
export interface OverviewTotals {
  revenueCents: number;
  /** Orders that count: not cancelled, not expired. */
  orders: number;
  /** Every order placed, whatever became of it. */
  placed: number;
  /** Distinct customers with a counted order. */
  customers: number;
  /** Customers whose first counted order in the scope falls in the period. */
  newCustomers: number;
  /** Null without a counted order. */
  avgCheckCents: number | null;
  cancelled: number;
  /** Never accepted in time — the café's no-shows. */
  expired: number;
  /** Cancelled and expired among the orders placed, 0..100; null when none was placed. */
  cancelRatePercent: number | null;
  /** READY to PICKED_UP, seconds; null without a handed-over order. */
  avgPickupSeconds: number | null;
  /** Stores (business view) or brands (platform view) with at least one counted order. */
  activeUnits: number;
  /** The platform's commission on that revenue, at each brand's current rate. */
  commissionCents: number;
}

/** One local day of the current period. */
export interface OverviewDay {
  date: string;
  revenueCents: number;
  orders: number;
  customers: number;
  newCustomers: number;
  cancelled: number;
  expired: number;
  commissionCents: number;
}

/** Counted orders by the local hour they were placed at (each store's own zone), 0..23. */
export interface OverviewHour {
  hour: number;
  orders: number;
  revenueCents: number;
}

/** Counted orders by local weekday, ISO numbering: 1 = Monday … 7 = Sunday. */
export interface OverviewWeekday {
  weekday: number;
  orders: number;
  revenueCents: number;
}

/**
 * One store (or brand) over the period. Revenue, orders and shares on every
 * plan; the fields after `detailed` are the comparison a PRO brand gets and
 * stay null otherwise.
 */
export interface OverviewRow {
  id: string;
  name: string;
  revenueCents: number;
  orders: number;
  /** Share of the period's revenue, 0..100, one decimal. */
  sharePercent: number;
  /** Share of the period's orders, 0..100, one decimal. */
  ordersSharePercent: number;
  detailed: boolean;
  previousRevenueCents: number | null;
  previousOrders: number | null;
  /** Percent; null when the period before had no revenue. */
  revenueDeltaPercent: number | null;
  avgCheckCents: number | null;
  customers: number | null;
  cancelled: number | null;
  expired: number | null;
  cancelRatePercent: number | null;
  avgPickupSeconds: number | null;
}

/** What a business sees on its dashboard. */
export interface BusinessOverview {
  period: OverviewPeriod;
  current: OverviewTotals;
  previous: OverviewTotals;
  daily: OverviewDay[];
  /** Orders placed in the period per `OrderStatus`, every status present. */
  statuses: Record<string, number>;
  /** Every store in scope, idle ones too, highest revenue first. */
  byStore: OverviewRow[];
  /** True when `byStore` carries the PRO comparison. */
  storeComparison: boolean;
  /** Load by hour and weekday — PRO (`deepAnalytics`); null otherwise. */
  byHour: OverviewHour[] | null;
  byWeekday: OverviewWeekday[] | null;
}

/** A brand in the platform view; money is in the overview's currency. */
export interface PlatformBrandRow extends OverviewRow {
  currency: string;
  plan: 'BASIC' | 'PRO';
  commissionBps: number;
  commissionCents: number;
  previousCommissionCents: number;
  stores: number;
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/**
 * The platform's dashboard. Brands sell in their own currencies and money is
 * never summed across them: the figures cover the brands of `currency`, and
 * `currencies` lists every currency there is to switch to.
 */
export interface PlatformOverview {
  period: OverviewPeriod;
  /** Null when there is no brand at all. */
  currency: string | null;
  currencies: string[];
  current: OverviewTotals;
  previous: OverviewTotals;
  daily: OverviewDay[];
  statuses: Record<string, number>;
  byBrand: PlatformBrandRow[];
  byHour: OverviewHour[];
  byWeekday: OverviewWeekday[];
}
