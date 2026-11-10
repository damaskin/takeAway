import type { TakeawayPromoAdminErrorCode } from '@takeaway/shared-types';

import type { ApiErrorWording } from '../../core/http/api-error';

const CODES: Record<TakeawayPromoAdminErrorCode, string> = {
  TAKEAWAY_PROMO_CODE_TAKEN: 'admin.takeawayPromos.errors.TAKEAWAY_PROMO_CODE_TAKEN',
  TAKEAWAY_PROMO_USED: 'admin.takeawayPromos.errors.TAKEAWAY_PROMO_USED',
  TAKEAWAY_PROMO_DATES: 'admin.takeawayPromos.errors.TAKEAWAY_PROMO_DATES',
  TAKEAWAY_PROMO_PERCENT: 'admin.takeawayPromos.errors.TAKEAWAY_PROMO_PERCENT',
  TAKEAWAY_PROMO_BUDGET: 'admin.takeawayPromos.errors.TAKEAWAY_PROMO_BUDGET',
  TAKEAWAY_PROMO_WELCOME_TAKEN: 'admin.takeawayPromos.errors.TAKEAWAY_PROMO_WELCOME_TAKEN',
  TAKEAWAY_PROMO_STATUS: 'admin.takeawayPromos.errors.TAKEAWAY_PROMO_STATUS',
};

/** How the promo form words the API's refusals. */
export const TAKEAWAY_PROMO_FORM_ERRORS: ApiErrorWording = {
  codes: CODES,
  network: 'common.networkError',
};

/**
 * Switching on and off: TAKEAWAY_PROMO_BUDGET there is the 409 of an
 * exhausted promo with nothing left, not a budget typed below what was spent.
 */
export const TAKEAWAY_PROMO_STATUS_ERRORS: ApiErrorWording = {
  codes: { ...CODES, TAKEAWAY_PROMO_BUDGET: 'admin.takeawayPromos.errors.budgetExhausted' },
  statuses: { 500: 'admin.takeawayPromos.errors.statusFailed' },
  network: 'common.networkError',
};
