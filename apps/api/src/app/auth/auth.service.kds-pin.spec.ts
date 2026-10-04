import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type User } from '@prisma/client';

import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { KDS_PIN_MAX_FAILURES, KdsPinService } from './services/kds-pin.service';
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

describe('AuthService.loginWithKdsPin', () => {
  function build(env: Record<string, string>, rows: Row[] = []) {
    const values = new Map<string, string>();
    const redis = {
      get: async (key: string) => values.get(key) ?? null,
      del: async (...keys: string[]) => keys.forEach((k) => values.delete(k)),
      incrWithTtl: async (key: string) => {
        const next = Number(values.get(key) ?? 0) + 1;
        values.set(key, String(next));
        return next;
      },
      raw: { expire: async () => 1 },
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
      device: { create: jest.fn().mockResolvedValue({ id: 'device-1' }) },
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
    );
    return { auth, pins, findFirst, tokens };
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

  it('signs in with the PIN that was set, and refuses a different one', async () => {
    const env = { KDS_PIN_SECRET: 'a-real-secret' };
    const signer = build(env).pins;
    const row = barista({ kdsPinHash: signer.hash('store-1', '4821') });
    const { auth } = build(env, [row]);

    await expect(auth.loginWithKdsPin('store-1', '4821')).resolves.toMatchObject({ user: { id: 'barista-1' } });
    await expect(auth.loginWithKdsPin('store-1', '1111')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.loginWithKdsPin('store-2', '4821')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each<Record<string, string>>([{}, { KDS_PIN_SECRET: 'CHANGE_ME' }])(
    'refuses with 503 KDS_PIN_NOT_CONFIGURED without a secret (%o), whatever is stored',
    async (env) => {
      // The exact row the old build wrote for any PIN when the secret was missing.
      const sentinel = 'unset:' + Buffer.from('store-1').toString('base64url');
      const { auth, findFirst } = build(env, [barista({ kdsPinHash: sentinel })]);

      const error = await auth.loginWithKdsPin('store-1', '0000').catch((e: unknown) => e as HttpException);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_NOT_CONFIGURED' });
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it('never lets a legacy "unset:" row in, even once a secret is set', async () => {
    const sentinel = 'unset:' + Buffer.from('store-1').toString('base64url');
    const { auth, findFirst } = build({ KDS_PIN_SECRET: 'a-real-secret' }, [barista({ kdsPinHash: sentinel })]);

    await expect(auth.loginWithKdsPin('store-1', '1234')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findFirst.mock.calls[0]?.[0].where.NOT).toEqual({ kdsPinHash: { startsWith: 'unset:' } });
  });

  it(`locks the store after ${KDS_PIN_MAX_FAILURES} wrong PINs — even the right PIN is refused`, async () => {
    const env = { KDS_PIN_SECRET: 'a-real-secret' };
    const signer = build(env).pins;
    const { auth, tokens } = build(env, [barista({ kdsPinHash: signer.hash('store-1', '4821') })]);

    for (let i = 0; i < KDS_PIN_MAX_FAILURES; i++) {
      await expect(auth.loginWithKdsPin('store-1', String(1000 + i))).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const error = await auth.loginWithKdsPin('store-1', '4821').catch((e: unknown) => e as HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'KDS_PIN_LOCKED' });
    expect(tokens.issue).not.toHaveBeenCalled();
  });
});
