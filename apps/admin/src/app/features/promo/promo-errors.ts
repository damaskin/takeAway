import type { ApiErrorWording } from '../../core/http/api-error';

/** How the promo screens word the API's refusals. */
export const PROMO_ERROR_WORDING: ApiErrorWording = {
  codes: {
    PROMO_CODE_TAKEN: 'admin.promo.errors.PROMO_CODE_TAKEN',
    PROMO_NOT_EDITABLE: 'admin.promo.errors.PROMO_NOT_EDITABLE',
    PROMO_STATUS_NOT_ALLOWED: 'admin.promo.errors.PROMO_STATUS_NOT_ALLOWED',
    PROMO_ENDED: 'admin.promo.errors.PROMO_ENDED',
    PROMO_DATES: 'admin.promo.errors.PROMO_DATES',
    PROMO_STORE: 'admin.promo.errors.PROMO_STORE',
  },
  network: 'common.networkError',
};
