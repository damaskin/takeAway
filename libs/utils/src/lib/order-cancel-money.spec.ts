import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ORDER_CANCEL_MONEY_TEXT, readCancelMoney } from './order-cancel-money';

describe('readCancelMoney', () => {
  it('knows the four outcomes and nothing else', () => {
    expect(readCancelMoney('RELEASED')).toBe('RELEASED');
    expect(readCancelMoney('PENDING')).toBe('PENDING');
    expect(readCancelMoney('SOMETHING_NEW')).toBeNull();
    expect(readCancelMoney(null)).toBeNull();
    expect(readCancelMoney(undefined)).toBeNull();
  });
});

/**
 * The mobile app cannot import the sentences, so its strings are checked
 * against them here: the push, the web, the Mini App and the app say the
 * same thing about the money.
 */
describe('ORDER_CANCEL_MONEY_TEXT in the mobile app', () => {
  const ARB_KEYS = {
    NOT_CHARGED: 'cancelMoneyNotCharged',
    RELEASED: 'cancelMoneyReleased',
    REFUNDED: 'cancelMoneyRefunded',
    PENDING: 'cancelMoneyHoldPending',
  } as const;
  const arb = (locale: 'ru' | 'en'): Record<string, unknown> =>
    JSON.parse(readFileSync(join(__dirname, `../../../../apps/mobile/lib/l10n/app_${locale}.arb`), 'utf8'));

  it.each(['ru', 'en'] as const)('matches app_%s.arb word for word', (locale) => {
    const strings = arb(locale);
    for (const [money, key] of Object.entries(ARB_KEYS)) {
      expect(strings[key]).toBe(ORDER_CANCEL_MONEY_TEXT[money as keyof typeof ARB_KEYS][locale]);
    }
  });
});
