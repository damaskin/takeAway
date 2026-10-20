import type { TranslateService } from '@ngx-translate/core';

import { apiErrorMessage, type ApiErrorWording } from '../../core/http/api-error';

/** How the Staff screens word the API's errors. */
const STAFF_ERRORS: ApiErrorWording = {
  codes: {
    STAFF_STORE_OUT_OF_SCOPE: 'admin.staff.errors.storeOutOfScope',
    STAFF_ROLE_NOT_ALLOWED: 'admin.staff.errors.roleNotAllowed',
    STAFF_NOT_EDITABLE: 'admin.staff.errors.notEditable',
    STAFF_ALREADY_ON_TEAM: 'admin.staff.errors.alreadyOnTeam',
    STAFF_EMAIL_TAKEN: 'admin.staff.errors.emailTaken',
    LOGIN_IN_USE: 'admin.staff.errors.loginTaken',
    STAFF_SIGN_IN_REQUIRED: 'admin.staff.errors.signInRequired',
    STAFF_HAS_SIGN_IN: 'admin.staff.errors.hasSignIn',
    STAFF_NO_SIGN_IN: 'admin.staff.errors.noSignIn',
    KDS_PIN_ROLE: 'admin.staff.errors.pinRole',
    KDS_PIN_MULTI_BRAND: 'admin.staff.errors.pinMultiBrand',
    KDS_PIN_TAKEN: 'admin.stores.errors.pinTaken',
    KDS_PIN_FORMAT: 'admin.stores.errors.pinFormat',
    KDS_PIN_TOO_SIMPLE: 'admin.stores.errors.pinTooSimple',
    KDS_PIN_NOT_CONFIGURED: 'admin.stores.errors.pinNotConfigured',
  },
  messages: {
    'Staff member not found': 'admin.staff.errors.notFound',
    'Brand is outside your scope': 'admin.staff.errors.forbidden',
    'pin must be exactly 6 digits': 'admin.stores.errors.pinFormat',
  },
  statuses: { 403: 'admin.staff.errors.forbidden', 404: 'admin.staff.errors.notFound' },
  fields: {
    email: 'admin.staff.email',
    login: 'admin.staff.login',
    name: 'admin.staff.name',
    tempPassword: 'admin.staff.tempPassword',
    storeIds: 'admin.staff.storesLabel',
    role: 'admin.staff.roleLabel',
    pin: 'admin.staff.kitchenPin',
  },
  invalidField: 'admin.staff.errors.invalidField',
};

/** Readable text for a failed Staff request, in the admin's language. */
export function staffErrorMessage(err: unknown, translate: TranslateService): string {
  return apiErrorMessage(err, translate, STAFF_ERRORS);
}
