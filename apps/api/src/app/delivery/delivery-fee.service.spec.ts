import { ConfigService } from '@nestjs/config';

import { DeliveryFeeService } from './delivery-fee.service';

/**
 * DeliveryFeeService is pure logic + env knobs — no DB, no IO. Cover the
 * interesting branches of the tiered pricing and the fallbacks so future
 * tweaks to the formula don't silently regress.
 */
describe('DeliveryFeeService.quote', () => {
  const STORE = { storeLatitude: 25.078, storeLongitude: 55.141 }; // Dubai Marina

  function build(env: Record<string, number | string> = {}): DeliveryFeeService {
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    return new DeliveryFeeService(config);
  }

  it('falls back to flat fee when customer coords are absent', () => {
    const svc = build({ DELIVERY_FEE_CENTS: 300 });
    expect(svc.quote(STORE)).toEqual({
      feeCents: 300,
      distanceM: null,
      deliverable: true,
      reason: 'NO_COORDS_FLAT',
    });
  });

  it('inside the free radius → base fee, correct distance', () => {
    const svc = build({
      DELIVERY_FEE_BASE_CENTS: 200,
      DELIVERY_FEE_PER_KM_CENTS: 100,
      DELIVERY_FREE_RADIUS_M: 500,
    });
    // ~50 m offset
    const q = svc.quote({ ...STORE, customerLatitude: 25.0785, customerLongitude: 55.141 });
    expect(q.deliverable).toBe(true);
    expect(q.reason).toBe('OK');
    expect(q.distanceM).toBeLessThan(100);
    expect(q.feeCents).toBe(200);
  });

  it('scales fee per km past the free radius', () => {
    const svc = build({
      DELIVERY_FEE_BASE_CENTS: 200,
      DELIVERY_FEE_PER_KM_CENTS: 100,
      DELIVERY_FREE_RADIUS_M: 500,
      DELIVERY_MAX_RADIUS_M: 7000,
    });
    // ~2.5 km offset (0.023 deg lat ≈ 2.56 km)
    const q = svc.quote({ ...STORE, customerLatitude: 25.101, customerLongitude: 55.141 });
    expect(q.deliverable).toBe(true);
    expect(q.reason).toBe('OK');
    expect(q.distanceM).toBeGreaterThan(2000);
    expect(q.distanceM).toBeLessThan(3000);
    // billable ≈ distance - 500 m; at $1/km should be ~$2 + $2 base = $4
    expect(q.feeCents).toBeGreaterThan(350);
    expect(q.feeCents).toBeLessThan(500);
  });

  it('refuses delivery past the max radius', () => {
    const svc = build({ DELIVERY_MAX_RADIUS_M: 3000 });
    // ~5 km offset
    const q = svc.quote({ ...STORE, customerLatitude: 25.123, customerLongitude: 55.141 });
    expect(q.deliverable).toBe(false);
    expect(q.reason).toBe('OUTSIDE_RADIUS');
    expect(q.distanceM).toBeGreaterThan(3000);
  });

  it('uses defaults when env keys are missing', () => {
    const svc = build({});
    const q = svc.quote({ ...STORE, customerLatitude: 25.08, customerLongitude: 55.141 });
    // ~220 m away — inside default 500 m free radius → base 200
    expect(q.feeCents).toBe(200);
    expect(q.deliverable).toBe(true);
  });

  it('treats NaN / negative env values as unset and falls through to defaults', () => {
    const svc = build({
      DELIVERY_FEE_BASE_CENTS: 'not-a-number' as unknown as string,
      DELIVERY_FEE_PER_KM_CENTS: -50,
    });
    const q = svc.quote({ ...STORE, customerLatitude: 25.08, customerLongitude: 55.141 });
    // Should fall back to 200 base + 100 per km defaults → ~200 at 220 m
    expect(q.feeCents).toBe(200);
  });

  it('rounds distance to the nearest metre', () => {
    const svc = build();
    const q = svc.quote({ ...STORE, customerLatitude: 25.0785, customerLongitude: 55.141 });
    expect(Number.isInteger(q.distanceM)).toBe(true);
  });
});
