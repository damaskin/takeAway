import type { PromoStatus } from './loyalty';

/**
 * How a promo moves through its life. The business sees four steps —
 * draft, active, paused, ended — and the API keeps five statuses: an active
 * promo is SCHEDULED until its start date and RUNNING after it. Both work
 * at checkout inside their dates. The admin and the API read the same
 * rules from here.
 */
export const PROMO_TRANSITIONS: Readonly<Record<PromoStatus, readonly PromoStatus[]>> = {
  // Starting it makes it SCHEDULED or RUNNING, depending on the start date.
  DRAFT: ['RUNNING'],
  SCHEDULED: ['PAUSED', 'EXPIRED'],
  RUNNING: ['PAUSED', 'EXPIRED'],
  PAUSED: ['RUNNING', 'EXPIRED'],
  // Ended is final; a new run is a new promo.
  EXPIRED: [],
};

export interface PromoTiming {
  status: PromoStatus;
  startsAt: string | Date;
  endsAt: string | Date;
}

/**
 * The status a promo really has now: an active promo before its start is
 * SCHEDULED, after it RUNNING, and an active or paused one past its end is
 * EXPIRED, whatever was stored when somebody last pressed a button.
 */
export function promoEffectiveStatus(promo: PromoTiming, now: Date = new Date()): PromoStatus {
  const t = now.getTime();
  const ended = t > new Date(promo.endsAt).getTime();
  if (promo.status === 'PAUSED') return ended ? 'EXPIRED' : 'PAUSED';
  if (promo.status !== 'RUNNING' && promo.status !== 'SCHEDULED') return promo.status;
  if (ended) return 'EXPIRED';
  return t < new Date(promo.startsAt).getTime() ? 'SCHEDULED' : 'RUNNING';
}

/** Where the business may move a promo from where it stands now. */
export function promoNextStatuses(promo: PromoTiming, now: Date = new Date()): readonly PromoStatus[] {
  return PROMO_TRANSITIONS[promoEffectiveStatus(promo, now)];
}

/**
 * Whether every field of a promo may still change: a draft, or a scheduled
 * or paused promo nobody has used yet. Once a code was redeemed, its terms
 * are part of somebody's order and only the status moves.
 */
export function isPromoEditable(promo: PromoTiming & { redemptionsCount: number }, now: Date = new Date()): boolean {
  const status = promoEffectiveStatus(promo, now);
  if (status === 'DRAFT') return true;
  return (status === 'SCHEDULED' || status === 'PAUSED') && promo.redemptionsCount === 0;
}
