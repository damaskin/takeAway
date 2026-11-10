import type { ConfigService } from '@nestjs/config';

import { AgroprombankQrConfig } from '../payments/agroprombank-qr/agroprombank-qr.config';
import { FeatureFlagsService } from './feature-flags.service';

function withEnv(env: Record<string, string>): FeatureFlagsService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new FeatureFlagsService(config, new AgroprombankQrConfig(config));
}

describe('FeatureFlagsService.support', () => {
  it('is empty when nothing is configured', () => {
    expect(withEnv({}).support).toEqual({ email: null, telegram: null });
  });

  it.each(['takeaway_help', '@takeaway_help', 't.me/takeaway_help', 'https://t.me/takeaway_help'])(
    'turns %s into a link',
    (raw) => {
      expect(withEnv({ SUPPORT_TELEGRAM: raw }).support.telegram).toBe('https://t.me/takeaway_help');
    },
  );

  it('rides along in the public snapshot', () => {
    expect(withEnv({ SUPPORT_EMAIL: ' help@takeaway.md ' }).snapshot()).toEqual({
      deliveryEnabled: false,
      agroprombankEnabled: false,
      cardPaymentFlow: 'none',
      qrPaymentCurrencies: [],
      support: { email: 'help@takeaway.md', telegram: null },
    });
  });
});

describe('FeatureFlagsService.qrPaymentCurrencies', () => {
  const qr = {
    AGROPROMBANK_QR_TERMINAL_ID: 'QRT169007299815722',
    AGROPROMBANK_QR_LOGIN: 'takeaway',
    AGROPROMBANK_QR_PASSWORD: 'secret',
  };

  it('offers RUP while the QR payment is on and configured', () => {
    expect(withEnv({ ...qr, AGROPROMBANK_QR_ENABLED: 'true' }).snapshot().qrPaymentCurrencies).toEqual(['RUP']);
  });

  it('offers nothing while it is off, or on without its settings', () => {
    expect(withEnv(qr).qrPaymentCurrencies).toEqual([]);
    expect(withEnv({ AGROPROMBANK_QR_ENABLED: 'true' }).qrPaymentCurrencies).toEqual([]);
  });
});

describe('FeatureFlagsService.cardPaymentFlow', () => {
  it('is off with neither flow enabled', () => {
    expect(withEnv({ CARD_PAYMENT_FLOW: 'web' }).cardPaymentFlow).toBe('none');
  });

  it('keeps bound cards by default', () => {
    expect(withEnv({ AGROPROMBANK_ENABLED: 'true', AGROPROMBANK_WEB_ENABLED: 'true' }).cardPaymentFlow).toBe('token');
  });

  it('switches to the bank page when asked and enabled', () => {
    expect(withEnv({ CARD_PAYMENT_FLOW: 'web', AGROPROMBANK_WEB_ENABLED: 'true' }).cardPaymentFlow).toBe('web');
  });

  // The switch can be flipped ahead of the bank's credentials.
  it('stays on bound cards until Web-платёж is switched on', () => {
    expect(withEnv({ CARD_PAYMENT_FLOW: 'web', AGROPROMBANK_ENABLED: 'true' }).cardPaymentFlow).toBe('token');
  });
});
