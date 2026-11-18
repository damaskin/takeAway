import type { Params } from '@angular/router';
import { parseInactiveDays } from '@takeaway/shared-types';

/**
 * The inactive-customer segment as the admin links to it. The rule lives in
 * the API (customers/customer-segment.ts) and the threshold in
 * `@takeaway/shared-types`: at least 3 counted orders and none for N days —
 * 7, 14, 30, 90 or any whole number from 1 to 365, 14 by default — at one
 * store or the whole brand. One threshold everywhere: the dashboard card,
 * the win-back tab, the customers filter, the campaign composer and the
 * promo form all pass it on as `inactiveDays`, so each opens on the same
 * people.
 */
export {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_DAY_PRESETS,
  INACTIVE_MIN_ORDERS,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
  isInactiveDays,
  parseInactiveDays,
} from '@takeaway/shared-types';

export interface InactiveSegment {
  /** Days without an order. */
  days: number;
  /** Only orders at this store count; null for the whole brand. */
  storeId: string | null;
}

/**
 * The threshold a link brought: `inactiveDays`, or the names older links
 * used for it (`window` on the analytics page, `days` on «Клиенты»).
 */
export function inactiveDaysFromQuery(query: { get(name: string): string | null }, ...older: string[]): number | null {
  for (const name of ['inactiveDays', ...older]) {
    const days = parseInactiveDays(query.get(name));
    if (days !== null) return days;
  }
  return null;
}

/** «Клиенты» filtered to the segment. */
export function customersLink(segment: InactiveSegment): { commands: string[]; queryParams: Params } {
  return {
    commands: ['/customers'],
    queryParams: { segment: 'inactive', inactiveDays: segment.days, storeId: segment.storeId ?? undefined },
  };
}

/** The campaign composer with the segment as its audience, and the copy mentioning `code` if given. */
export function campaignLink(segment: InactiveSegment, code?: string): { commands: string[]; queryParams: Params } {
  return {
    commands: ['/campaigns/new'],
    queryParams: {
      audience: 'INACTIVE',
      inactiveDays: segment.days,
      storeId: segment.storeId ?? undefined,
      code: code ?? undefined,
    },
  };
}

/**
 * The promo form prefilled for the segment. `then: 'campaign'` sends the
 * saved code straight on to the composer — the «акция» of the win-back tab.
 */
export function promoLink(segment: InactiveSegment, then?: 'campaign'): { commands: string[]; queryParams: Params } {
  return {
    commands: ['/promotions/promo/new'],
    queryParams: {
      for: 'inactive',
      inactiveDays: segment.days,
      storeId: segment.storeId ?? undefined,
      then: then ?? undefined,
    },
  };
}
