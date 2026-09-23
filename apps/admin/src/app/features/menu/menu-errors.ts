import type { TranslateService } from '@ngx-translate/core';

import { apiErrorCode, apiErrorMessage, type ApiErrorWording } from '../../core/http/api-error';

/** The API's menu error codes (see the API's admin-menu.errors.ts); each has a text under `admin.menu.errors`. */
const MENU_CODES = [
  'SLUG_TAKEN',
  'CATEGORY_NOT_EMPTY',
  'CATEGORY_MOVE_TARGET',
  'MIXED_CATEGORIES',
  'MODIFIER_RANGE',
  'TOO_MANY_IMAGES',
  'IMAGE_NOT_ON_PRODUCT',
  'IMAGES_CHANGED',
] as const;

/** Request properties the menu forms send, for "check the field …" when validation fails. */
const MENU_FIELDS = [
  'name',
  'slug',
  'description',
  'basePriceCents',
  'prepTimeSeconds',
  'caffeineLevel',
  'calories',
  'proteinsGrams',
  'fatsGrams',
  'carbsGrams',
  'allergens',
  'dietTags',
  'visible',
  'priceDeltaCents',
  'minCount',
  'maxCount',
  'sortOrder',
] as const;

const MENU_WORDING: ApiErrorWording = {
  codes: Object.fromEntries(MENU_CODES.map((code) => [code, `admin.menu.errors.${code}`])),
  statuses: Object.fromEntries(
    [403, 404, 413, 415, 500, 503].map((status) => [status, `admin.menu.errors.status.${status}`]),
  ),
  fields: Object.fromEntries(MENU_FIELDS.map((field) => [field, `admin.menu.fields.${field}`])),
  invalidField: 'admin.menu.errors.invalidField',
  network: 'admin.menu.errors.status.0',
};

/**
 * One sentence for a failed menu request, in the admin's language wherever
 * we know what went wrong — the shared API-error wording with the menu's
 * codes, statuses and field names. What used to reach the screen was
 * Angular's "Http failure response for … 400 Bad Request".
 *
 * `statuses` overrides a status where the screen knows better: a 503 on a
 * photo upload means storage is not set up, not that the server is down.
 */
export function describeMenuError(
  err: unknown,
  translate: TranslateService,
  statuses: Partial<Record<number, string>> = {},
): string {
  const overrides = Object.fromEntries(
    Object.entries(statuses).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return apiErrorMessage(err, translate, { ...MENU_WORDING, statuses: { ...MENU_WORDING.statuses, ...overrides } });
}

/** The API's domain error code, when the failure carries one. */
export function menuErrorCode(err: unknown): string | null {
  return apiErrorCode(err);
}
