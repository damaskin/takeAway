import type { TranslateService } from '@ngx-translate/core';

import type { LocaleFormatService } from './locale-format';

/**
 * Words for an order-path error the API sent with a stable code —
 * «В это время точка закрыта» instead of "The store is closed at that time".
 * Takes the error body (or a promo validation result reshaped like one) and
 * fills in what the code needs: the items that ran out, the minimum order in
 * money, the booking window.
 *
 * Null when there is no code, or none this build has words for, so the
 * caller can fall back to its own message.
 */
export function checkoutErrorText(body: unknown, translate: TranslateService, fmt: LocaleFormatService): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b['code'] !== 'string' || !b['code']) return null;

  const params: Record<string, string | number> = {};
  if (Array.isArray(b['items'])) params['items'] = b['items'].filter((i) => typeof i === 'string').join(', ');
  if (typeof b['minOrderCents'] === 'number') {
    params['amount'] = fmt.money(b['minOrderCents'], typeof b['currency'] === 'string' ? b['currency'] : null);
  }
  if (typeof b['minMinutes'] === 'number') params['minMinutes'] = b['minMinutes'];
  if (typeof b['maxHours'] === 'number') params['maxHours'] = b['maxHours'];

  const key = `common.checkoutErrors.${b['code']}`;
  const text: unknown = translate.instant(key, params);
  return typeof text === 'string' && text !== key ? text : null;
}
