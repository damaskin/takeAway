import type { TranslateService } from '@ngx-translate/core';

import { apiErrorBody, apiErrorMessage, type ApiErrorWording } from '../../core/http/api-error';

/** How the stores screens word the API's errors. */
const STORE_ERRORS: ApiErrorWording = {
  codes: {
    STORE_HAS_ORDERS: 'admin.stores.errors.hasOrders',
    STORE_CURRENCY_LOCKED: 'admin.stores.errors.currencyLocked',
    STORE_SLUG_TAKEN: 'admin.stores.errors.slugTaken',
    STORE_GALLERY_FULL: 'admin.stores.errors.galleryFull',
    KDS_PIN_TAKEN: 'admin.stores.errors.pinTaken',
  },
  messages: {
    'timezone must be an IANA time zone such as Europe/Chisinau': 'admin.stores.errors.timezone',
    'slug may only contain lower-case latin letters, digits and single hyphens': 'admin.stores.errors.slugFormat',
    'hours must list each weekday at most once': 'admin.stores.errors.hoursDuplicate',
    'Store not found': 'admin.stores.errors.notFound',
    'The photo is not in the gallery': 'admin.stores.errors.photoGone',
    'The image is larger than 5 MB': 'admin.stores.errors.imageTooLarge',
    'Only JPEG, PNG, WebP or AVIF images are accepted': 'admin.stores.errors.imageType',
    'Object storage is not configured on this deployment': 'admin.stores.errors.storageOff',
    'pin must match /^[0-9]{4,6}$/ regular expression': 'admin.stores.errors.pinFormat',
    'PIN must be 4 to 6 digits': 'admin.stores.errors.pinFormat',
    'Staff is not rostered for this store': 'admin.stores.errors.notRostered',
    'User is not eligible for a KDS PIN': 'admin.stores.errors.notEligible',
  },
  statuses: {
    403: 'admin.stores.errors.forbidden',
    413: 'admin.stores.errors.imageTooLarge',
    415: 'admin.stores.errors.imageType',
  },
  fields: {
    name: 'admin.stores.fields.name',
    slug: 'admin.stores.fields.slug',
    addressLine: 'admin.stores.fields.addressLine',
    city: 'admin.stores.fields.city',
    country: 'admin.stores.fields.country',
    latitude: 'admin.stores.fields.latitude',
    longitude: 'admin.stores.fields.longitude',
    timezone: 'admin.stores.fields.timezone',
    currency: 'admin.stores.fields.currency',
    phone: 'admin.stores.fields.phone',
    email: 'admin.stores.fields.email',
    taxRateBps: 'admin.stores.ops.taxRate',
    fulfillmentTypes: 'admin.stores.ops.fulfillment',
    pickupPointType: 'admin.stores.ops.pickupPoint',
    baseEtaSeconds: 'admin.stores.ops.baseEta',
    kitchenParallelism: 'admin.stores.ops.parallelism',
    slotCapacity: 'admin.stores.ops.slotCapacity',
    minOrderCents: 'admin.stores.ops.minOrderShort',
    deliveryFeeBaseCents: 'admin.stores.delivery.baseFeeShort',
    deliveryFeePerKmCents: 'admin.stores.delivery.perKmShort',
    deliveryFreeRadiusM: 'admin.stores.delivery.freeRadius',
    deliveryMaxRadiusM: 'admin.stores.delivery.maxRadius',
    hours: 'admin.stores.editor.tabs.hours',
    workingHours: 'admin.stores.editor.tabs.hours',
    pin: 'admin.stores.kitchen.pin',
  },
  invalidField: 'admin.stores.errors.invalidField',
  network: 'admin.stores.errors.network',
};

/** Readable text for a failed stores request, in the admin's language. */
export function storeErrorMessage(err: unknown, translate: TranslateService): string {
  const body = apiErrorBody(err);
  const missing = body?.['missing'];
  if (body?.code === 'STORE_NOT_READY' && Array.isArray(missing)) {
    const list = missing.map((check) => translate.instant(`admin.stores.readiness.missing.${String(check)}`));
    return translate.instant('admin.stores.errors.notReady', { missing: list.join(', ') });
  }
  return apiErrorMessage(err, translate, STORE_ERRORS);
}
