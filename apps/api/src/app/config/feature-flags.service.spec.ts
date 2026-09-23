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
      support: { email: 'help@takeaway.md', telegram: null },
    });
  });
});
