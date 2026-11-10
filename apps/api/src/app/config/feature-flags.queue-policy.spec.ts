import type { ConfigService } from '@nestjs/config';

import { AgroprombankQrConfig } from '../payments/agroprombank-qr/agroprombank-qr.config';
import { FeatureFlagsService } from './feature-flags.service';

function withEnv(env: Record<string, string>): FeatureFlagsService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new FeatureFlagsService(config, new AgroprombankQrConfig(config));
}

describe('FeatureFlagsService.queuePolicyEnabled', () => {
  it('is off unless QUEUE_POLICY_ENABLED says otherwise', () => {
    expect(withEnv({}).queuePolicyEnabled).toBe(false);
    expect(withEnv({ QUEUE_POLICY_ENABLED: 'false' }).queuePolicyEnabled).toBe(false);
    expect(withEnv({ QUEUE_POLICY_ENABLED: 'true' }).queuePolicyEnabled).toBe(true);
  });

  it('rides in the public snapshot only while on, so a deployment with it off answers as before', () => {
    expect(withEnv({}).snapshot()).not.toHaveProperty('queuePolicyEnabled');
    expect(withEnv({ QUEUE_POLICY_ENABLED: '1' }).snapshot()).toMatchObject({ queuePolicyEnabled: true });
  });
});
