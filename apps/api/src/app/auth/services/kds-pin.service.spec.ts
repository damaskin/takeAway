import { ConfigService } from '@nestjs/config';

import { KdsPinService } from './kds-pin.service';

describe('KdsPinService', () => {
  const config = (env: Record<string, string>): ConfigService =>
    ({ get: (key: string) => env[key] }) as unknown as ConfigService;

  it('only accepts 4–6 digit PINs', () => {
    const svc = new KdsPinService(config({ KDS_PIN_SECRET: 's' }));
    expect(svc.isValidFormat('1234')).toBe(true);
    expect(svc.isValidFormat('123456')).toBe(true);
    expect(svc.isValidFormat('123')).toBe(false); // too short
    expect(svc.isValidFormat('1234567')).toBe(false); // too long
    expect(svc.isValidFormat('12 34')).toBe(false); // non-digit
    expect(svc.isValidFormat('abcd')).toBe(false);
  });

  it('hashes the same PIN to the same value within a store, and different across stores', () => {
    const svc = new KdsPinService(config({ KDS_PIN_SECRET: 'sek' }));
    const a = svc.hash('store-A', '1234');
    const a2 = svc.hash('store-A', '1234');
    const b = svc.hash('store-B', '1234');
    expect(a).toBe(a2);
    expect(a).not.toBe(b); // store id is part of the input
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('matches() rejects when the candidate hash differs', () => {
    const svc = new KdsPinService(config({ KDS_PIN_SECRET: 'sek' }));
    const stored = svc.hash('store-A', '1234');
    expect(svc.matches('store-A', '1234', stored)).toBe(true);
    expect(svc.matches('store-A', '1235', stored)).toBe(false);
    expect(svc.matches('store-B', '1234', stored)).toBe(false);
  });

  it('returns a non-matchable sentinel when KDS_PIN_SECRET is unset', () => {
    const svc = new KdsPinService(config({}));
    const sentinel = svc.hash('store-A', '1234');
    expect(sentinel.startsWith('unset:')).toBe(true);
    // Without the secret, matches() against a real-looking hex hash should
    // still fail safely instead of accidentally returning true.
    expect(svc.matches('store-A', '1234', 'a'.repeat(64))).toBe(false);
  });
});
