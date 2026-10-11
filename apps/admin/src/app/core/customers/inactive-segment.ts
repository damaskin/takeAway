import type { Params } from '@angular/router';

/**
 * The inactive-customer segment as the admin links to it. The rule lives in
 * the API (customers/customer-segment.ts): at least 3 counted orders and
 * none for 3, 7 or 14 days, at one store or the whole brand. The win-back
 * tab, the dashboard widget, the customers filter, the campaign composer
 * and the promo form all pass it on in these query params, so each opens
 * on the same people.
 */
export const INACTIVE_DAYS = [3, 7, 14] as const;
export type InactiveDays = (typeof INACTIVE_DAYS)[number];
export const DEFAULT_INACTIVE_DAYS: InactiveDays = 14;
/** Orders a customer needs before going quiet makes them inactive. */
export const INACTIVE_MIN_ORDERS = 3;

export interface InactiveSegment {
  days: InactiveDays;
  /** Only orders at this store count; null for the whole brand. */
  storeId: string | null;
}

export function parseInactiveDays(raw: string | null | undefined): InactiveDays | null {
  const n = Number(raw);
  return (INACTIVE_DAYS as readonly number[]).includes(n) ? (n as InactiveDays) : null;
}

/** «Клиенты» filtered to the segment. */
export function customersLink(segment: InactiveSegment): { commands: string[]; queryParams: Params } {
  return {
    commands: ['/customers'],
    queryParams: { segment: 'inactive', days: segment.days, storeId: segment.storeId ?? undefined },
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
