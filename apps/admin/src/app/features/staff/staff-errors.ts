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
  },
  messages: {
    'Staff member not found': 'admin.staff.errors.notFound',
    'Brand is outside your scope': 'admin.staff.errors.forbidden',
  },
  statuses: { 403: 'admin.staff.errors.forbidden', 404: 'admin.staff.errors.notFound' },
  fields: {
    email: 'admin.staff.email',
    name: 'admin.staff.name',
    tempPassword: 'admin.staff.tempPassword',
    storeIds: 'admin.staff.storesLabel',
    role: 'admin.staff.roleLabel',
  },
  invalidField: 'admin.staff.errors.invalidField',
};

/** Readable text for a failed Staff request, in the admin's language. */
export function staffErrorMessage(err: unknown, translate: TranslateService): string {
  return apiErrorMessage(err, translate, STAFF_ERRORS);
}
