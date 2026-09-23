import { HttpErrorResponse } from '@angular/common/http';
import type { TranslateService } from '@ngx-translate/core';

import { apiErrorCode, apiErrorMessage, type ApiErrorWording } from './api-error';

/** Renders a key and its params, so assertions read what the user would. */
const translate = {
  instant: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
} as unknown as TranslateService;

const wording: ApiErrorWording = {
  codes: { STORE_HAS_ORDERS: 'stores.hasOrders', STORE_GALLERY_FULL: 'stores.galleryFull' },
  messages: { 'timezone must be an IANA time zone such as Europe/Chisinau': 'stores.timezone' },
  statuses: { 403: 'stores.forbidden' },
  fields: { latitude: 'fields.latitude', hours: 'fields.hours' },
  invalidField: 'stores.invalidField',
  network: 'stores.network',
};

function failure(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, url: '/api/admin/stores' });
}

describe('apiErrorMessage', () => {
  it('words a conflict by its code, with the body as params', () => {
    const err = failure(409, { code: 'STORE_GALLERY_FULL', message: 'A store gallery holds at most 8 photos', max: 8 });
    expect(apiErrorCode(err)).toBe('STORE_GALLERY_FULL');
    expect(apiErrorMessage(err, translate, wording)).toBe(
      'stores.galleryFull{"code":"STORE_GALLERY_FULL","message":"A store gallery holds at most 8 photos","max":8}',
    );
  });

  it('turns a list of validation messages into sentences instead of "Http failure response"', () => {
    const err = failure(400, {
      statusCode: 400,
      error: 'Bad Request',
      message: [
        'timezone must be an IANA time zone such as Europe/Chisinau',
        'latitude must be a latitude string or number',
        'hours.2.opensAt must not be greater than 1440',
        'property status should not exist',
      ],
    });
    expect(apiErrorMessage(err, translate, wording)).toBe(
      'stores.timezone. stores.invalidField{"field":"fields.latitude"}. stores.invalidField{"field":"fields.hours"}. property status should not exist.',
    );
  });

  it('keeps an unknown message as sent, and words a known status', () => {
    expect(
      apiErrorMessage(failure(400, { message: 'Send the image as multipart/form-data' }), translate, wording),
    ).toBe('Send the image as multipart/form-data');
    expect(apiErrorMessage(failure(403, { message: 'Store is outside your scope' }), translate, wording)).toBe(
      'stores.forbidden',
    );
  });

  it('does not show a server fault or a dropped connection as raw text', () => {
    expect(apiErrorMessage(failure(500, { message: 'Internal server error' }), translate, wording)).toBe(
      'common.genericError',
    );
    expect(apiErrorMessage(failure(0, null), translate, wording)).toBe('stores.network');
    expect(apiErrorMessage(new Error('boom'), translate)).toBe('common.genericError');
  });
});
