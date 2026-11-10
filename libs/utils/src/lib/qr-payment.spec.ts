import {
  checkoutPaymentMethod,
  looksLikePhone,
  qrPaymentOffered,
  qrPaymentWorthPolling,
  qrTimeLeftMs,
  readCheckoutPaymentMethod,
} from './qr-payment';

describe('qrPaymentOffered', () => {
  it('offers QR for a store in a currency the QR payment takes', () => {
    expect(qrPaymentOffered('RUP', ['RUP'])).toBe(true);
    expect(qrPaymentOffered('MDL', ['RUP'])).toBe(false);
  });

  // An API from before the field, or the QR payment switched off.
  it('offers nothing when the list is absent or empty, or the store has no currency yet', () => {
    expect(qrPaymentOffered('RUP', undefined)).toBe(false);
    expect(qrPaymentOffered('RUP', [])).toBe(false);
    expect(qrPaymentOffered(null, ['RUP'])).toBe(false);
  });
});

describe('checkoutPaymentMethod', () => {
  it('keeps the card unless the customer chose QR last time, when both are on', () => {
    expect(checkoutPaymentMethod({ card: true, qr: true }, null)).toBe('CARD');
    expect(checkoutPaymentMethod({ card: true, qr: true }, 'QR')).toBe('QR');
    expect(checkoutPaymentMethod({ card: true, qr: true }, 'CARD')).toBe('CARD');
  });

  it('takes the only way there is, whatever was remembered', () => {
    expect(checkoutPaymentMethod({ card: false, qr: true }, 'CARD')).toBe('QR');
    expect(checkoutPaymentMethod({ card: true, qr: false }, 'QR')).toBe('CARD');
    expect(checkoutPaymentMethod({ card: false, qr: false }, 'QR')).toBeNull();
  });

  it('reads back only the choices it knows', () => {
    expect(readCheckoutPaymentMethod('QR')).toBe('QR');
    expect(readCheckoutPaymentMethod('CARD')).toBe('CARD');
    expect(readCheckoutPaymentMethod('APPLE_PAY')).toBeNull();
    expect(readCheckoutPaymentMethod(null)).toBeNull();
  });
});

describe('qrTimeLeftMs', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');

  it('counts down to the end of the invoice and stops at zero', () => {
    expect(qrTimeLeftMs('2026-11-10T12:09:30Z', now)).toBe(570_000);
    expect(qrTimeLeftMs('2026-11-10T11:59:00Z', now)).toBe(0);
  });

  it('reads an unreadable time as already over', () => {
    expect(qrTimeLeftMs('soon', now)).toBe(0);
    expect(qrTimeLeftMs(null, now)).toBe(0);
  });
});

describe('qrPaymentWorthPolling', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const pending = (expiresAt: string) => ({
    status: 'PENDING' as const,
    qr: { code: 'QRT1:1.00:1', appLink: null, expiresAt },
  });

  it('keeps asking while the invoice waits, and a little after it lapsed', () => {
    expect(qrPaymentWorthPolling(pending('2026-11-10T12:05:00Z'), now)).toBe(true);
    // Lapsed a minute ago: a payment from its last second may still land.
    expect(qrPaymentWorthPolling(pending('2026-11-10T11:59:00Z'), now)).toBe(true);
    expect(qrPaymentWorthPolling(pending('2026-11-10T11:56:59Z'), now)).toBe(false);
  });

  it('stops once the invoice is settled either way', () => {
    for (const status of ['PAID', 'EXPIRED', 'REFUNDED', 'FAILED'] as const) {
      expect(qrPaymentWorthPolling({ status, qr: null }, now)).toBe(false);
    }
  });
});

describe('looksLikePhone', () => {
  it('knows a phone or a tablet from a desktop', () => {
    expect(looksLikePhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe(true);
    expect(looksLikePhone('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe(true);
    expect(looksLikePhone('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36')).toBe(false);
    expect(looksLikePhone(undefined)).toBe(false);
  });
});
