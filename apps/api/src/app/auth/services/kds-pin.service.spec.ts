import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RedisService } from '../../redis/redis.service';
import {
  KDS_PIN_FREE_ATTEMPTS,
  KDS_PIN_BRAND_LOCK_SECONDS,
  KDS_PIN_BRAND_MAX_FAILURES,
  KDS_PIN_MAX_LOCK_SECONDS,
  KdsPinService,
  lockSecondsAfter,
} from './kds-pin.service';

/** Just enough Redis for the failure counters and pauses: values plus their TTLs. */
function fakeRedis() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const redis = {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ttl?: number) => {
      values.set(key, value);
      if (ttl) ttls.set(key, ttl);
    }),
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
      ttl: jest.fn(async (key: string) => (values.has(key) ? (ttls.get(key) ?? -1) : -2)),
    },
  };
  return { redis: redis as unknown as RedisService, values, ttls, mock: redis };
}

describe('KdsPinService', () => {
  const config = (env: Record<string, string>): ConfigService =>
    ({ get: (key: string) => env[key] }) as unknown as ConfigService;
  const build = (env: Record<string, string>) => new KdsPinService(config(env), fakeRedis().redis);

  it('accepts 4–6 digit PINs at the tablet, so PINs set before the 6-digit rule keep working', () => {
    const svc = build({ KDS_PIN_SECRET: 's' });
    expect(svc.isValidFormat('1234')).toBe(true);
    expect(svc.isValidFormat('123456')).toBe(true);
    expect(svc.isValidFormat('123')).toBe(false); // too short
    expect(svc.isValidFormat('1234567')).toBe(false); // too long
    expect(svc.isValidFormat('12 34')).toBe(false); // non-digit
    expect(svc.isValidFormat('abcd')).toBe(false);
  });

  it('hashes the same PIN to the same value within a scope, and different across scopes and PINs', () => {
    const svc = build({ KDS_PIN_SECRET: 'sek' });
    const a = svc.hash('brand-A', '1234');
    expect(svc.hash('brand-A', '1234')).toBe(a);
    expect(svc.hash('brand-B', '1234')).not.toBe(a); // the scope id is part of the input
    expect(svc.hash('brand-A', '1235')).not.toBe(a); // and so is the PIN
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('hashes a PIN for the brand, and an old PIN for its store, the same way under different scopes', () => {
    const svc = build({ KDS_PIN_SECRET: 'sek' });
    expect(svc.brandHash('brand-A', '480317')).toBe(svc.hash('brand-A', '480317'));
    expect(svc.storeHash('store-A', '480317')).toBe(svc.hash('store-A', '480317'));
    expect(svc.brandHash('brand-A', '480317')).not.toBe(svc.brandHash('brand-B', '480317'));
    expect(svc.brandHash('brand-A', '480317')).not.toBe(svc.storeHash('store-A', '480317'));
  });

  it('matches() rejects when the candidate hash differs', () => {
    const svc = build({ KDS_PIN_SECRET: 'sek' });
    const stored = svc.hash('brand-A', '1234');
    expect(svc.matches('brand-A', '1234', stored)).toBe(true);
    expect(svc.matches('brand-A', '1235', stored)).toBe(false);
    expect(svc.matches('brand-B', '1234', stored)).toBe(false);
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
    expect(() => svc.hash('brand-A', '1234')).toThrow(ServiceUnavailableException);
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
    expect(svc.matches('brand-A', '1234', 'a'.repeat(64))).toBe(false);
  });

  it('never treats a legacy "unset:" placeholder as a usable hash, even once a secret is set', () => {
    const svc = build({ KDS_PIN_SECRET: 'sek' });
    const sentinel = 'unset:' + Buffer.from('brand-A').toString('base64url');
    expect(svc.isUsableHash(sentinel)).toBe(false);
    expect(svc.isUsableHash(null)).toBe(false);
    expect(svc.matches('brand-A', '1234', sentinel)).toBe(false);
    expect(svc.isUsableHash(svc.hash('brand-A', '1234'))).toBe(true);
  });

  it('sets only 6-digit PINs that are not a first guess', () => {
    const svc = build({ KDS_PIN_SECRET: 's' });
    expect(svc.newPinProblem('418273')).toBeNull();
    expect(svc.newPinProblem('1234')).toBe('FORMAT'); // still typed on the tablet, no longer set
    expect(svc.newPinProblem('12345')).toBe('FORMAT');
    expect(svc.newPinProblem('1234567')).toBe('FORMAT');
    expect(svc.newPinProblem('12a456')).toBe('FORMAT');
    for (const easy of ['000000', '777777', '123456', '345678', '987654', '654321']) {
      expect(svc.newPinProblem(easy)).toBe('TOO_SIMPLE');
    }
    const error = (() => {
      try {
        svc.assertNewPinAllowed('111111');
        return null;
      } catch (e) {
        return e as HttpException;
      }
    })();
    expect(error?.getStatus()).toBe(400);
    expect(error?.getResponse()).toMatchObject({ code: 'KDS_PIN_TOO_SIMPLE' });
  });

  describe('lockout per tablet and brand', () => {
    it('pauses after the free attempts and doubles the pause up to an hour', () => {
      expect(lockSecondsAfter(KDS_PIN_FREE_ATTEMPTS - 1)).toBe(0);
      expect(lockSecondsAfter(KDS_PIN_FREE_ATTEMPTS)).toBe(60);
      expect(lockSecondsAfter(KDS_PIN_FREE_ATTEMPTS + 1)).toBe(120);
      expect(lockSecondsAfter(KDS_PIN_FREE_ATTEMPTS + 3)).toBe(480);
      expect(lockSecondsAfter(KDS_PIN_FREE_ATTEMPTS + 6)).toBe(KDS_PIN_MAX_LOCK_SECONDS);
      expect(lockSecondsAfter(500)).toBe(KDS_PIN_MAX_LOCK_SECONDS);
    });

    it('locks the tablet that typed the wrong PINs — not the other tablets of the brand', async () => {
      const { redis } = fakeRedis();
      const svc = new KdsPinService(config({ KDS_PIN_SECRET: 'sek' }), redis);

      for (let i = 0; i < KDS_PIN_FREE_ATTEMPTS - 1; i++) await svc.recordFailure('brand-A', 'tablet-1');
      await expect(svc.assertNotLocked('brand-A', 'tablet-1')).resolves.toBeUndefined();

      await svc.recordFailure('brand-A', 'tablet-1');
      const error = await svc.assertNotLocked('brand-A', 'tablet-1').catch((e: unknown) => e as HttpException);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_LOCKED', retryAfterSeconds: 60 });

      // The brand's other tablet, and another brand, keep working.
      await expect(svc.assertNotLocked('brand-A', 'tablet-2')).resolves.toBeUndefined();
      await expect(svc.assertNotLocked('brand-B', 'tablet-1')).resolves.toBeUndefined();
    });

    it('a successful sign-in clears that tablet’s count and pause', async () => {
      const { redis } = fakeRedis();
      const svc = new KdsPinService(config({ KDS_PIN_SECRET: 'sek' }), redis);
      for (let i = 0; i < KDS_PIN_FREE_ATTEMPTS + 2; i++) await svc.recordFailure('brand-A', 'tablet-1');
      await svc.clearFailures('brand-A', 'tablet-1');
      await expect(svc.assertNotLocked('brand-A', 'tablet-1')).resolves.toBeUndefined();
      // The next mistake starts from zero again.
      await svc.recordFailure('brand-A', 'tablet-1');
      await expect(svc.assertNotLocked('brand-A', 'tablet-1')).resolves.toBeUndefined();
    });

    it(`pauses the whole brand after ${KDS_PIN_BRAND_MAX_FAILURES} wrong PINs in an hour across tablets`, async () => {
      const { redis, ttls } = fakeRedis();
      const svc = new KdsPinService(config({ KDS_PIN_SECRET: 'sek' }), redis);
      for (let i = 0; i < KDS_PIN_BRAND_MAX_FAILURES; i++) await svc.recordFailure('brand-A', `tablet-${i}`);

      const error = await svc.assertNotLocked('brand-A', 'fresh-tablet').catch((e: unknown) => e as HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect(ttls.get('kds-pin:brand-lock:brand-A')).toBe(KDS_PIN_BRAND_LOCK_SECONDS);
    });
  });
});
