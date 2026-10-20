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

type Row = Pick<User, 'id' | 'role' | 'blockedAt' | 'kdsPinHash' | 'kdsPinStoreId' | 'kdsPinBrandId' | 'locale'>;

interface Not {
  NOT?: { kdsPinHash?: { startsWith?: string } };
}

/** Stores and the brand each belongs to; names sort Mall before Station. */
const STORES = [
  { id: 'store-1', brandId: 'brand-1', name: 'Station', city: 'Tiraspol' },
  { id: 'store-2', brandId: 'brand-1', name: 'Mall', city: 'Tiraspol' },
  { id: 'other-store', brandId: 'brand-2', name: 'Kacheli', city: 'Chisinau' },
];

/** Tablet tokens the fake knows: two NoName tablets, a tablet of another brand. */
const TABLETS: Record<string, ResolvedKitchenDevice> = {
  'noname-tablet-token': { id: 'tablet-1', brandId: 'brand-1', brandName: 'NoName' },
  'second-noname-tablet': { id: 'tablet-2', brandId: 'brand-1', brandName: 'NoName' },
  'kacheli-tablet-token': { id: 'tablet-9', brandId: 'brand-2', brandName: 'Качели' },
};

/** A UserStore row. */
interface Link {
  userId: string;
  storeId: string;
}

const AT_STORE_1: Link[] = [{ userId: 'barista-1', storeId: 'store-1' }];
const env = { KDS_PIN_SECRET: 'a-real-secret' };
const TABLET = 'noname-tablet-token';
const signer = new KdsPinService(
  { get: (k: string) => (env as Record<string, string>)[k] } as ConfigService,
  {
    raw: {},
  } as unknown as RedisService,
);

describe('AuthService.loginWithKdsPin', () => {
  function build(config: Record<string, string>, rows: Row[] = [], links: Link[] = AT_STORE_1) {
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
    const cfg = { get: (key: string) => config[key] } as unknown as ConfigService;
    const pins = new KdsPinService(cfg, redis);
    const sentinelOut = (where: Not, r: Row) => {
      const prefix = where.NOT?.kdsPinHash?.startsWith;
      return !(prefix && r.kdsPinHash?.startsWith(prefix));
    };

    // Emulates Postgres for the two lookups the login runs, NOT clause included.
    const findFirst = jest.fn(
      async ({ where }: { where: Not & { kdsPinBrandId: string; kdsPinHash: string } }) =>
        rows.find(
          (r) => r.kdsPinBrandId === where.kdsPinBrandId && r.kdsPinHash === where.kdsPinHash && sentinelOut(where, r),
        ) ?? null,
    );
    const findMany = jest.fn(
      async ({
        where,
      }: {
        where: Not & { kdsPinBrandId: null; OR: Array<{ kdsPinStoreId: string; kdsPinHash: string }> };
      }) =>
        rows.filter(
          (r) =>
            r.kdsPinBrandId === null &&
            where.OR.some((c) => c.kdsPinStoreId === r.kdsPinStoreId && c.kdsPinHash === r.kdsPinHash) &&
            sentinelOut(where, r),
        ),
    );
    const prisma = {
      user: { findFirst, findMany },
      store: {
        findMany: jest.fn(async ({ where }: { where: { brandId: string } }) =>
          STORES.filter((s) => s.brandId === where.brandId)
            .map(({ id, name, city }) => ({ id, name, city }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      },
      userStore: {
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
          links
            .filter((l) => l.userId === where.userId)
            .map((l) => ({
              storeId: l.storeId,
              store: { brandId: STORES.find((s) => s.id === l.storeId)?.brandId ?? 'gone' },
            })),
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
      cfg,
      devices as unknown as KitchenDeviceService,
    );
    return { auth, findFirst, findMany, tokens, devices, values };
  }

  /** A barista with the brand PIN (the kind set since 2026-10-20). */
  const barista = (pin: string | null, overrides: Partial<Row> = {}): Row => ({
    id: 'barista-1',
    role: Role.STAFF,
    blockedAt: null,
    kdsPinHash: pin ? signer.brandHash('brand-1', pin) : null,
    kdsPinBrandId: pin ? 'brand-1' : null,
    kdsPinStoreId: null,
    locale: 'RU' as Row['locale'],
    ...overrides,
  });
  /** Someone with an old PIN that opens one store. */
  const legacy = (id: string, storeId: string, pin: string): Row => ({
    id,
    role: Role.STAFF,
    blockedAt: null,
    kdsPinHash: signer.storeHash(storeId, pin),
    kdsPinBrandId: null,
    kdsPinStoreId: storeId,
    locale: 'RU' as Row['locale'],
  });

  async function errorOf(promise: Promise<unknown>): Promise<HttpException> {
    return promise.then(
      () => {
        throw new Error('expected a refusal');
      },
      (e: unknown) => e as HttpException,
    );
  }

  it('signs in with the PIN first — no store needed — and refuses a different PIN', async () => {
    const { auth } = build(env, [barista('418273')]);

    await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET })).resolves.toMatchObject({
      user: { id: 'barista-1' },
      kdsBrandId: 'brand-1',
      kdsStoreId: 'store-1',
    });
    await expect(auth.loginWithKdsPin({ pin: '111111', deviceToken: TABLET })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('does not open another brand’s tablet with the PIN', async () => {
    const { auth } = build(env, [barista('418273')]);
    await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: 'kacheli-tablet-token' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('opens a session bound to the tablet’s brand, listing the person’s stores there, and stamps the tablet', async () => {
    const links = [...AT_STORE_1, { userId: 'barista-1', storeId: 'store-2' }];
    const { auth, tokens, devices } = build(env, [barista('418273')], links);

    const session = await auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET });
    expect(session.kdsStores).toEqual([
      { id: 'store-2', name: 'Mall', city: 'Tiraspol' },
      { id: 'store-1', name: 'Station', city: 'Tiraspol' },
    ]);
    // Without a store asked for, the board opens on the first one; the tablet lets the person pick.
    expect(session.kdsStoreId).toBe('store-2');
    expect(tokens.issue).toHaveBeenCalledWith('barista-1', 'device-1', {
      kdsBrandId: 'brand-1',
      kdsStoreId: 'store-2',
    });
    expect(devices.touch).toHaveBeenCalledWith('tablet-1');
  });

  it('opens on the store the tablet asked for, when it is one of the person’s', async () => {
    const links = [...AT_STORE_1, { userId: 'barista-1', storeId: 'store-2' }];
    const { auth } = build(env, [barista('418273')], links);
    await expect(
      auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET, storeId: 'store-1' }),
    ).resolves.toMatchObject({ kdsStoreId: 'store-1' });
  });

  it('keeps an old store PIN working — 4 digits too — on its own store', async () => {
    const { auth, tokens } = build(env, [legacy('barista-1', 'store-1', '4821')]);
    const session = await auth.loginWithKdsPin({ pin: '4821', deviceToken: TABLET });
    expect(session).toMatchObject({ user: { id: 'barista-1' }, kdsStoreId: 'store-1', kdsBrandId: 'brand-1' });
    expect(tokens.issue).toHaveBeenCalledWith('barista-1', 'device-1', {
      kdsBrandId: 'brand-1',
      kdsStoreId: 'store-1',
    });
  });

  it('prefers the brand PIN to an old store PIN with the same digits', async () => {
    const links = [...AT_STORE_1, { userId: 'cook-1', storeId: 'store-2' }];
    const { auth, findMany } = build(env, [barista('418273'), legacy('cook-1', 'store-2', '418273')], links);
    await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET })).resolves.toMatchObject({
      user: { id: 'barista-1' },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('asks for the store when two people share an old PIN at different stores, and then lets the right one in', async () => {
    const links = [...AT_STORE_1, { userId: 'cook-1', storeId: 'store-2' }];
    const { auth, values } = build(
      env,
      [legacy('barista-1', 'store-1', '5555'), legacy('cook-1', 'store-2', '5555')],
      links,
    );

    const error = await errorOf(auth.loginWithKdsPin({ pin: '5555', deviceToken: TABLET }));
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'KDS_PIN_STORE_REQUIRED' });
    // The PIN was right: nothing is counted against the tablet.
    expect([...values.keys()]).toEqual([]);

    await expect(auth.loginWithKdsPin({ pin: '5555', deviceToken: TABLET, storeId: 'store-2' })).resolves.toMatchObject(
      {
        user: { id: 'cook-1' },
        kdsStoreId: 'store-2',
      },
    );
  });

  it('refuses a request without a tablet token with KDS_DEVICE_REQUIRED, before looking at the PIN', async () => {
    const { auth, findFirst } = build(env, [barista('418273')]);

    const error = await errorOf(auth.loginWithKdsPin({ pin: '418273' }));
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'KDS_DEVICE_REQUIRED' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unknown or unbound tablet with KDS_DEVICE_UNKNOWN', async () => {
    const { auth, findFirst } = build(env);
    const error = await errorOf(auth.loginWithKdsPin({ pin: '418273', deviceToken: 'made-up-token-0000' }));
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'KDS_DEVICE_UNKNOWN' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('refuses a store of another brand without counting it — an outsider cannot lock a kitchen', async () => {
    const { auth, findFirst, values } = build(env, [barista('418273')]);

    for (let i = 0; i < KDS_PIN_FREE_ATTEMPTS + 3; i++) {
      await expect(
        auth.loginWithKdsPin({ pin: '000000', deviceToken: TABLET, storeId: 'other-store' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(findFirst).not.toHaveBeenCalled();
    expect([...values.keys()]).toEqual([]);
    await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET })).resolves.toMatchObject({
      user: { id: 'barista-1' },
    });
  });

  it.each<Record<string, string>>([{}, { KDS_PIN_SECRET: 'CHANGE_ME' }])(
    'refuses with 503 KDS_PIN_NOT_CONFIGURED without a secret (%o), whatever is stored',
    async (noSecret) => {
      // The exact row the old build wrote for any PIN when the secret was missing.
      const sentinel = 'unset:' + Buffer.from('store-1').toString('base64url');
      const { auth, findFirst } = build(noSecret, [barista(null, { kdsPinHash: sentinel, kdsPinStoreId: 'store-1' })]);

      const error = await errorOf(auth.loginWithKdsPin({ pin: '0000', deviceToken: TABLET }));
      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toMatchObject({ code: 'KDS_PIN_NOT_CONFIGURED' });
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it('never lets a legacy "unset:" row in, even once a secret is set', async () => {
    const sentinel = 'unset:' + Buffer.from('store-1').toString('base64url');
    const { auth, findFirst, findMany } = build(env, [
      barista(null, { kdsPinHash: sentinel, kdsPinStoreId: 'store-1' }),
    ]);

    await expect(auth.loginWithKdsPin({ pin: '1234', deviceToken: TABLET })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findFirst.mock.calls[0]?.[0].where.NOT).toEqual({ kdsPinHash: { startsWith: 'unset:' } });
    expect(findMany.mock.calls[0]?.[0].where.NOT).toEqual({ kdsPinHash: { startsWith: 'unset:' } });
  });

  it(`pauses the tablet after ${KDS_PIN_FREE_ATTEMPTS} wrong PINs — even the right PIN waits, the other tablet does not`, async () => {
    const { auth, tokens } = build(env, [barista('418273')]);

    for (let i = 0; i < KDS_PIN_FREE_ATTEMPTS; i++) {
      await expect(auth.loginWithKdsPin({ pin: String(100000 + i), deviceToken: TABLET })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    const error = await errorOf(auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET }));
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({ code: 'KDS_PIN_LOCKED', retryAfterSeconds: 60 });
    expect(tokens.issue).not.toHaveBeenCalled();

    await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: 'second-noname-tablet' })).resolves.toMatchObject({
      user: { id: 'barista-1' },
    });
  });

  it('keeps the PINs of owners and platform admins off the tablet', async () => {
    const { auth, tokens } = build(env, [barista('418273', { role: Role.BRAND_ADMIN })]);
    await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  describe('the session stays within the brand of the tablet', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it('refuses the right PIN of an account that also works for another brand, and logs it', async () => {
      const links = [...AT_STORE_1, { userId: 'barista-1', storeId: 'other-store' }];
      const { auth, tokens } = build(env, [barista('418273')], links);

      await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('barista-1'));
    });

    it('refuses the PIN of someone who works at none of the brand’s stores any more', async () => {
      const { auth, tokens } = build(env, [barista('418273')], []);
      await expect(auth.loginWithKdsPin({ pin: '418273', deviceToken: TABLET })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('refuses an old store PIN once its store is no longer the person’s', async () => {
      const links = [{ userId: 'barista-1', storeId: 'store-2' }];
      const { auth, tokens } = build(env, [legacy('barista-1', 'store-1', '4821')], links);

      await expect(auth.loginWithKdsPin({ pin: '4821', deviceToken: TABLET })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });
});
