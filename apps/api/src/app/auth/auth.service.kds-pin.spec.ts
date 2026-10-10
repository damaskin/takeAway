import { HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';

import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { KDS_PIN_FREE_ATTEMPTS, KdsPinService } from './services/kds-pin.service';
import type { KitchenDeviceService, ResolvedKitchenDevice } from './services/kitchen-device.service';
import type { OAuthIdentityService } from './services/oauth-identity.service';
import type { PasswordService } from './services/password.service';
import type { TelegramService } from './services/telegram.service';
import type { TokensService } from './services/tokens.service';

type Row = Pick<User, 'id' | 'role' | 'blockedAt' | 'kdsPinHash' | 'kdsPinStoreId' | 'locale'>;

interface Where {
  kdsPinStoreId: string;
  kdsPinHash: string;
  NOT?: { kdsPinHash?: { startsWith?: string } };
}

/** Stores and the brand each belongs to. */
const STORES: Record<string, string> = { 'store-1': 'brand-1', 'store-2': 'brand-1', 'other-store': 'brand-2' };

/** Tablet tokens the fake knows: a NoName tablet, a tablet of another brand. */
const TABLETS: Record<string, ResolvedKitchenDevice> = {
  'noname-tablet-token': { id: 'tablet-1', brandId: 'brand-1', brandName: 'NoName' },
  'second-noname-tablet': { id: 'tablet-2', brandId: 'brand-1', brandName: 'NoName' },
  'kacheli-tablet-token': { id: 'tablet-9', brandId: 'brand-2', brandName: 'Качели' },
};

/** A UserStore row, with the brand of its store. */
interface Link {
  userId: string;
  storeId: string;
  brandId: string;
}

const AT_STORE_1: Link[] = [{ userId: 'barista-1', storeId: 'store-1', brandId: 'brand-1' }];

describe('AuthService.loginWithKdsPin', () => {
  function build(env: Record<string, string>, rows: Row[] = [], links: Link[] = AT_STORE_1) {
    const values = new Map<string, string>();
    const ttls = new Map<string, number>();
    const redis = {
      get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string, ttl?: number) => {
        values.set(key, value);
        if (ttl) ttls.set(key, ttl);
      },
      del: async (...keys: string[]) => keys.forEach((k) => values.delete(k)),
      incrWithTtl: async (key: string) => {
        const next = Number(values.get(key) ?? 0) + 1;
        values.set(key, String(next));
        return next;
      },
      raw: { ttl: async (key: string) => (values.has(key) ? (ttls.get(key) ?? -1) : -2) },
    } as unknown as RedisService;
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    const pins = new KdsPinService(config, redis);

    // Emulates Postgres for the one query the login runs, NOT clause included.
    const findFirst = jest.fn(async ({ where }: { where: Where }) => {
      const prefix = where.NOT?.kdsPinHash?.startsWith;
      return (
        rows.find(
          (r) =>
            r.kdsPinStoreId === where.kdsPinStoreId &&
            r.kdsPinHash === where.kdsPinHash &&
            !(prefix && r.kdsPinHash?.startsWith(prefix)),
        ) ?? null
      );
    });
    const prisma = {
      user: { findFirst },
      store: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          STORES[where.id] ? { brandId: STORES[where.id] } : null,
        ),
      },
      userStore: {
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
          links
            .filter((l) => l.userId === where.userId)
            .map((l) => ({ storeId: l.storeId, store: { brandId: l.brandId } })),
        ),
      },
      device: { create: jest.fn().mockResolvedValue({ id: 'device-1' }) },
    };
    const devices = {
      resolve: jest.fn(async (token?: string) => (token ? (TABLETS[token] ?? null) : null)),
      touch: jest.fn().mockResolvedValue(undefined),
    };
    const tokens = { issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }) };
    const auth = new AuthService(
      prisma as unknown as PrismaService,
      {} as UsersService,
      tokens as unknown as TokensService,
      {} as TelegramService,
      {} as OAuthIdentityService,
      {} as PasswordService,
      pins,
      {} as MailService,
      config,
      devices as unknown as KitchenDeviceService,
    );
    return { auth, pins, findFirst, tokens, devices, values };
  }

  const barista = (overrides: Partial<Row> = {}): Row => ({
    id: 'barista-1',
    role: Role.STAFF,
    blockedAt: null,
    kdsPinHash: null,
    kdsPinStoreId: 'store-1',
    locale: 'ru' as Row['locale'],
    ...overrides,
  });

  const env = { KDS_PIN_SECRET: 'a-real-secret' };
  const TABLET = 'noname-tablet-token';

  async function errorOf(promise: Promise<unknown>): Promise<HttpException> {
    return promise.then(
      () => {
        throw new Error('expected a refusal');
      },
      (e: unknown) => e as HttpException,
    );
  }

  it('signs in with the PIN that was set, and refuses a different one', async () => {
    const signer = build(env).pins;
    const row = barista({ kdsPinHash: signer.hash('store-1', '418273') });
    const { auth } = build(env, [row]);

    await expect(auth.loginWithKdsPin('store-1', '418273', TABLET)).resolves.toMatchObject({
      user: { id: 'barista-1' },
    });
    await expect(auth.loginWithKdsPin('store-1', '111111', TABLET)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.loginWithKdsPin('store-2', '418273', TABLET)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('still accepts a 4-digit PIN set before 6 digits became the rule', async () => {
    const signer = build(env).pins;
    const { auth } = build(env, [barista({ kdsPinHash: signer.hash('store-1', '4821') })]);
    await expect(auth.loginWithKdsPin('store-1', '4821', TABLET)).resolves.toMatchObject({ user: { id: 'barista-1' } });
  });

  it('opens a session narrowed to the PIN store and stamps the tablet', async () => {
    const signer = build(env).pins;
    const { auth, tokens, devices } = build(env, [barista({ kdsPinHash: signer.hash('store-1', '418273') })]);

    const session = await auth.loginWithKdsPin('store-1', '418273', TABLET);
    expect(session.kdsStoreId).toBe('store-1');
    expect(tokens.issue).toHaveBeenCalledWith('barista-1', 'device-1', { kdsStoreId: 'store-1' });
    expect(devices.touch).toHaveBeenCalledWith('tablet-1');
  });

  it('refuses a request without a tablet token with KDS_DEVICE_REQUIRED, before looking at the PIN', async () => {
    const signer = build(env).pins;
    const { auth, findFirst } = build(env, [barista({ kdsPinHash: signer.hash('store-1', '418273') })]);

    const error = await errorOf(auth.loginWithKdsPin('store-1', '418273'));
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'KDS_DEVICE_REQUIRED' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unknown or unbound tablet with KDS_DEVICE_UNKNOWN', async () => {
    const { auth, findFirst } = build(env);
    const error = await errorOf(auth.loginWithKdsPin('store-1', '418273', 'made-up-token-0000'));
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'KDS_DEVICE_UNKNOWN' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('refuses a store of another brand without counting it — an outsider cannot lock a kitchen', async () => {
    const signer = build(env).pins;
    const { auth, findFirst, values } = build(env, [barista({ kdsPinHash: signer.hash('store-1', '418273') })]);

    for (let i = 0; i < KDS_PIN_FREE_ATTEMPTS + 3; i++) {
      await expect(auth.loginWithKdsPin('store-1', '000000', 'kacheli-tablet-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    expect(findFirst).not.toHaveBeenCalled();
    expect([...values.keys()]).toEqual([]);
    // The kitchen's own tablet is unaffected.
    await expect(auth.loginWithKdsPin('store-1', '418273', TABLET)).resolves.toMatchObject({
      user: { id: 'barista-1' },
    });
  });

  it.each<Record<string, string>>([{}, { KDS_PIN_SECRET: 'CHANGE_ME' }])(
    'refuses with 503 KDS_PIN_NOT_CONFIGURED without a secret (%o), whatever is stored',
    async (noSecret) => {
      // The exact row the old build wrote for any PIN when the secret was missing.
      const sentinel = 'unset:' + Buffer.from('store-1').toString('base64url');
      const { auth, findFirst } = build(noSecret, [barista({ kdsPinHash: sentinel })]);

      const error = await errorOf(auth.loginWithKdsPin('store-1', '0000', TABLET));
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toMatchObject({ code: 'KDS_PIN_NOT_CONFIGURED' });
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it('never lets a legacy "unset:" row in, even once a secret is set', async () => {
    const sentinel = 'unset:' + Buffer.from('store-1').toString('base64url');
    const { auth, findFirst } = build(env, [barista({ kdsPinHash: sentinel })]);

    await expect(auth.loginWithKdsPin('store-1', '1234', TABLET)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findFirst.mock.calls[0]?.[0].where.NOT).toEqual({ kdsPinHash: { startsWith: 'unset:' } });
  });

  it(`pauses the tablet after ${KDS_PIN_FREE_ATTEMPTS} wrong PINs — even the right PIN waits, the other tablet does not`, async () => {
    const signer = build(env).pins;
    const { auth, tokens } = build(env, [barista({ kdsPinHash: signer.hash('store-1', '418273') })]);

    for (let i = 0; i < KDS_PIN_FREE_ATTEMPTS; i++) {
      await expect(auth.loginWithKdsPin('store-1', String(100000 + i), TABLET)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    const error = await errorOf(auth.loginWithKdsPin('store-1', '418273', TABLET));
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({ code: 'KDS_PIN_LOCKED', retryAfterSeconds: 60 });
    expect(tokens.issue).not.toHaveBeenCalled();

    await expect(auth.loginWithKdsPin('store-1', '418273', 'second-noname-tablet')).resolves.toMatchObject({
      user: { id: 'barista-1' },
    });
  });

  describe('the session stays within the brand of the store', () => {
    const env = { KDS_PIN_SECRET: 'a-real-secret' };
    const pinned = () => barista({ kdsPinHash: build(env).pins.hash('store-1', '4821') });
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it('signs in an account that works at several stores of the same brand', async () => {
      const links = [...AT_STORE_1, { userId: 'barista-1', storeId: 'store-2', brandId: 'brand-1' }];
      const { auth } = build(env, [pinned()], links);
      await expect(auth.loginWithKdsPin('store-1', '4821', TABLET)).resolves.toMatchObject({
        user: { id: 'barista-1' },
      });
    });

    it('refuses the right PIN of an account that also works for another brand, and logs it', async () => {
      const links = [...AT_STORE_1, { userId: 'barista-1', storeId: 'store-9', brandId: 'brand-2' }];
      const { auth, tokens } = build(env, [pinned()], links);

      await expect(auth.loginWithKdsPin('store-1', '4821', TABLET)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('barista-1'));
    });

    it('refuses the PIN of an account that no longer works at this store', async () => {
      const links = [{ userId: 'barista-1', storeId: 'store-2', brandId: 'brand-1' }];
      const { auth, tokens } = build(env, [pinned()], links);

      await expect(auth.loginWithKdsPin('store-1', '4821', TABLET)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });
});
