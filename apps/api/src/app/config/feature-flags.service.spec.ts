import type { ConfigService } from '@nestjs/config';

import { FeatureFlagsService } from './feature-flags.service';

function withEnv(env: Record<string, string>): FeatureFlagsService {
  return new FeatureFlagsService({ get: (key: string) => env[key] } as unknown as ConfigService);
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
      support: { email: 'help@takeaway.md', telegram: null },
    });
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
