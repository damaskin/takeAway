import { HttpErrorResponse } from '@angular/common/http';

import { apiErrorCode, apiErrorMessage, invalidFields } from './api-error';

function failure(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error });
}

describe('api-error', () => {
  it('reads the code of a coded conflict', () => {
    const err = failure(409, { statusCode: 409, code: 'PHONE_TAKEN', message: 'This phone number is already used' });

    expect(apiErrorCode(err)).toBe('PHONE_TAKEN');
  });

  it('names the fields a validation error complained about, once each', () => {
    const err = failure(400, {
      statusCode: 400,
      message: [
        'phone must be in international format, e.g. +37369123456',
        'currency must be one of the following values: USD, EUR',
        'currency should not be empty',
      ],
    });

    expect(invalidFields(err)).toEqual(['phone', 'currency']);
    expect(apiErrorCode(err)).toBeNull();
  });

  // Before, a 400 surfaced to the owner as "Http failure response for …: 400".
  it('joins the server messages instead of showing the transport error', () => {
    expect(apiErrorMessage(failure(400, { message: ['a is wrong', 'b is wrong'] }))).toBe('a is wrong; b is wrong');
    expect(apiErrorMessage(failure(404, { message: 'Brand not found' }))).toBe('Brand not found');
  });

  it('copes with a failure that has no JSON body at all', () => {
    const err = failure(0, new ProgressEvent('error'));

    expect(apiErrorCode(err)).toBeNull();
    expect(invalidFields(err)).toEqual([]);
    expect(apiErrorMessage(err)).toBeNull();
  });
});
