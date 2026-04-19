import { ConfigService } from '@nestjs/config';

import { DeliveryFeeService } from './delivery-fee.service';

/**
 * Covers only the per-store override behavior. Base formula coverage lives
 * in delivery-fee.service.spec.ts (added in PR #57) — keeping these in a
 * separate file so the two PRs can land without stepping on each other.
 */
describe('DeliveryFeeService.quote — per-store overrides', () => {
  const STORE = { storeLatitude: 25.078, storeLongitude: 55.141 };

  function build(env: Record<string, number | string> = {}): DeliveryFeeService {
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    return new DeliveryFeeService(config);
  }

  it('store base + per-km override take precedence over env', () => {
    const svc = build({
      DELIVERY_FEE_BASE_CENTS: 200,
      DELIVERY_FEE_PER_KM_CENTS: 100,
      DELIVERY_FREE_RADIUS_M: 500,
      DELIVERY_MAX_RADIUS_M: 7000,
    });
    // ~2.56 km offset
    const q = svc.quote({
      ...STORE,
      customerLatitude: 25.101,
      customerLongitude: 55.141,
      storeOverrides: { deliveryFeeBaseCents: 500, deliveryFeePerKmCents: 300 },
    });
    // Store-set pricing: 500 + ceil((2.56 - 0.5) * 300) ≈ 500 + 620 = ~1120
    expect(q.feeCents).toBeGreaterThan(1000);
    expect(q.feeCents).toBeLessThan(1400);
    expect(q.deliverable).toBe(true);
  });

  it('null overrides fall through to env defaults', () => {
    const svc = build({ DELIVERY_FEE_BASE_CENTS: 200 });
    const q = svc.quote({
      ...STORE,
      customerLatitude: 25.08,
      customerLongitude: 55.141,
      storeOverrides: {
        deliveryFeeBaseCents: null,
        deliveryFeePerKmCents: null,
        deliveryFreeRadiusM: null,
        deliveryMaxRadiusM: null,
      },
    });
    expect(q.feeCents).toBe(200);
  });

  it('negative override is ignored; env wins', () => {
    const svc = build({ DELIVERY_FEE_BASE_CENTS: 250 });
    const q = svc.quote({
      ...STORE,
      customerLatitude: 25.08,
      customerLongitude: 55.141,
      storeOverrides: { deliveryFeeBaseCents: -100 },
    });
    expect(q.feeCents).toBe(250);
  });

  it('store-specific max radius can refuse delivery that env would accept', () => {
    const svc = build({ DELIVERY_MAX_RADIUS_M: 10_000 });
    const q = svc.quote({
      ...STORE,
      customerLatitude: 25.101, // ~2.56 km
      customerLongitude: 55.141,
      storeOverrides: { deliveryMaxRadiusM: 1_000 },
    });
    expect(q.deliverable).toBe(false);
    expect(q.reason).toBe('OUTSIDE_RADIUS');
  });

  it('missing storeOverrides object behaves exactly like empty overrides', () => {
    const svc = build({ DELIVERY_FEE_BASE_CENTS: 200 });
    const withOverrides = svc.quote({
      ...STORE,
      customerLatitude: 25.08,
      customerLongitude: 55.141,
      storeOverrides: {},
    });
    const withoutOverrides = svc.quote({
      ...STORE,
      customerLatitude: 25.08,
      customerLongitude: 55.141,
    });
    expect(withOverrides.feeCents).toBe(withoutOverrides.feeCents);
  });
});
