import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RedisService } from '../../redis/redis.service';
import { KDS_PIN_LOCK_SECONDS, KDS_PIN_MAX_FAILURES, KdsPinService } from './kds-pin.service';

/** Just enough Redis for the failure counter: values plus their TTLs. */
function fakeRedis() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const redis = {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    del: jest.fn(async (...keys: string[]) => {
      for (const key of keys) {
        values.delete(key);
        ttls.delete(key);
      }
    }),
    incrWithTtl: jest.fn(async (key: string, ttl: number) => {
      const next = Number(values.get(key) ?? 0) + 1;
      values.set(key, String(next));
      if (next === 1) ttls.set(key, ttl);
      return next;
    }),
    raw: {
      expire: jest.fn(async (key: string, ttl: number) => {
        ttls.set(key, ttl);
        return 1;
      }),
    },
  };
  return { redis: redis as unknown as RedisService, values, ttls, mock: redis };
}

describe('KdsPinService', () => {
  const config = (env: Record<string, string>): ConfigService =>
    ({ get: (key: string) => env[key] }) as unknown as ConfigService;
  const build = (env: Record<string, string>) => new KdsPinService(config(env), fakeRedis().redis);

  it('only accepts 4–6 digit PINs', () => {
    const svc = build({ KDS_PIN_SECRET: 's' });
    expect(svc.isValidFormat('1234')).toBe(true);
    expect(svc.isValidFormat('123456')).toBe(true);
    expect(svc.isValidFormat('123')).toBe(false); // too short
    expect(svc.isValidFormat('1234567')).toBe(false); // too long
    expect(svc.isValidFormat('12 34')).toBe(false); // non-digit
    expect(svc.isValidFormat('abcd')).toBe(false);
  });

  it('hashes the same PIN to the same value within a store, and different across stores and PINs', () => {
    const svc = build({ KDS_PIN_SECRET: 'sek' });
    const a = svc.hash('store-A', '1234');
    expect(svc.hash('store-A', '1234')).toBe(a);
    expect(svc.hash('store-B', '1234')).not.toBe(a); // store id is part of the input
    expect(svc.hash('store-A', '1235')).not.toBe(a); // and so is the PIN
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('matches() rejects when the candidate hash differs', () => {
    const svc = build({ KDS_PIN_SECRET: 'sek' });
    const stored = svc.hash('store-A', '1234');
    expect(svc.matches('store-A', '1234', stored)).toBe(true);
    expect(svc.matches('store-A', '1235', stored)).toBe(false);
    expect(svc.matches('store-B', '1234', stored)).toBe(false);
  });

  it.each([
    ['unset', {}],
    ['empty', { KDS_PIN_SECRET: '' }],
    ['blank', { KDS_PIN_SECRET: '   ' }],
    ['the env example placeholder', { KDS_PIN_SECRET: 'CHANGE_ME' }],
  ])('refuses to hash anything when the secret is %s', (_label, env: Record<string, string>) => {
    const svc = build(env);
    expect(svc.isConfigured()).toBe(false);
    // Never a PIN-independent value a lookup could match — it throws.
    expect(() => svc.hash('store-A', '1234')).toThrow(ServiceUnavailableException);
    const error = (() => {
      try {
        svc.assertConfigured();
        return null;
      } catch (e) {
        return e as HttpException;
      }
    })();
    expect(error?.getStatus()).toBe(503);
    expect(error?.getResponse()).toMatchObject({ code: 'KDS_PIN_NOT_CONFIGURED' });
    expect(svc.matches('store-A', '1234', 'a'.repeat(64))).toBe(false);
  });

  it('never treats a legacy "unset:" placeholder as a usable hash, even once a secret is set', () => {
    const svc = build({ KDS_PIN_SECRET: 'sek' });
    const sentinel = 'unset:' + Buffer.from('store-A').toString('base64url');
    expect(svc.isUsableHash(sentinel)).toBe(false);
    expect(svc.isUsableHash(null)).toBe(false);
    expect(svc.matches('store-A', '1234', sentinel)).toBe(false);
    expect(svc.isUsableHash(svc.hash('store-A', '1234'))).toBe(true);
  });

  describe('per-store lockout', () => {
    it(`pauses a store after ${KDS_PIN_MAX_FAILURES} failures, for ${KDS_PIN_LOCK_SECONDS / 60} minutes`, async () => {
      const { redis, ttls } = fakeRedis();
      const svc = new KdsPinService(config({ KDS_PIN_SECRET: 'sek' }), redis);

      for (let i = 0; i < KDS_PIN_MAX_FAILURES - 1; i++) await svc.recordFailure('store-A');
      await expect(svc.assertNotLocked('store-A')).resolves.toBeUndefined();

      await svc.recordFailure('store-A');
      const error = await svc.assertNotLocked('store-A').catch((e: unknown) => e as HttpException);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_LOCKED' });
      expect(ttls.get('kds-pin:failures:store-A')).toBe(KDS_PIN_LOCK_SECONDS);

      // Other stores are unaffected.
      await expect(svc.assertNotLocked('store-B')).resolves.toBeUndefined();
    });

    it('a successful sign-in clears the counter', async () => {
      const { redis } = fakeRedis();
      const svc = new KdsPinService(config({ KDS_PIN_SECRET: 'sek' }), redis);
      for (let i = 0; i < KDS_PIN_MAX_FAILURES; i++) await svc.recordFailure('store-A');
      await svc.clearFailures('store-A');
      await expect(svc.assertNotLocked('store-A')).resolves.toBeUndefined();
    });
  });
});
