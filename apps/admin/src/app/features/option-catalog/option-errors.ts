import type { TranslateService } from '@ngx-translate/core';
import type { OptionCatalogErrorCode } from '@takeaway/shared-types';

import { apiErrorMessage, type ApiErrorWording } from '../../core/http/api-error';

const CODES: readonly OptionCatalogErrorCode[] = [
  'OPTION_GROUP_IN_USE',
  'OPTION_NAME_TAKEN',
  'OPTION_GROUP_INVALID',
  'OPTION_NOT_ON_PRODUCT',
];

/** Request properties of the catalog forms, for "check the field …" when validation fails. */
const FIELDS = ['name', 'note', 'minSelect', 'maxSelect', 'minQty', 'maxQty', 'defaultQty', 'priceCents'] as const;

const WORDING: ApiErrorWording = {
  codes: Object.fromEntries(CODES.map((code) => [code, `admin.optionsCatalog.errors.${code}`])),
  statuses: Object.fromEntries([403, 404, 500, 503].map((status) => [status, `admin.menu.errors.status.${status}`])),
  fields: Object.fromEntries(FIELDS.map((field) => [field, `admin.optionsCatalog.fields.${field}`])),
  invalidField: 'admin.menu.errors.invalidField',
  network: 'admin.menu.errors.status.0',
};

/**
 * One sentence for a failed catalog request: the catalog's error codes in
 * the admin's words; any other refusal shows the API's own message.
 */
export function describeOptionError(err: unknown, translate: TranslateService): string {
  return apiErrorMessage(err, translate, WORDING);
}
