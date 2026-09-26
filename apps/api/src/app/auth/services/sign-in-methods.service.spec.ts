import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthService } from '../auth.service';
import type { OAuthIdentityService } from './oauth-identity.service';
import { SignInMethodsService } from './sign-in-methods.service';
import type { TokensService } from './tokens.service';

interface FakeUser {
  id: string;
  role: Role;
  email: string | null;
  name: string | null;
  telegramUserId: bigint | null;
  blockedAt: Date | null;
  locale: 'EN' | 'RU';
}
interface FakeAccount {
  userId: string;
  provider: 'GOOGLE' | 'APPLE' | 'TELEGRAM';
  providerUserId: string;
}

/** Just enough of Prisma, in memory, for the linking rules to run for real. */
function fakeDb(users: FakeUser[], accounts: FakeAccount[], orders: Record<string, number>) {
  const findUser = (where: { id?: string; telegramUserId?: bigint; email?: string }) =>
    users.find(
      (u) =>
        (where.id !== undefined && u.id === where.id) ||
        (where.telegramUserId !== undefined && u.telegramUserId === where.telegramUserId) ||
        (where.email !== undefined && u.email === where.email),
    ) ?? null;
  const matches = (a: FakeAccount, where: Partial<FakeAccount>) =>
    Object.entries(where).every(([k, v]) => a[k as keyof FakeAccount] === v);

  const db: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(async ({ where, select }: { where: never; select?: unknown }) => {
        const u = findUser(where);
        if (!u || !select) return u;
        return { telegramUserId: u.telegramUserId, oauthAccounts: accounts.filter((a) => a.userId === u.id) };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: never }) => findUser(where)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = findUser(where) as FakeUser;
        for (const key of ['telegramUserId', 'email'] as const) {
          if (data[key] != null && users.some((o) => o !== u && o[key] === data[key])) {
            throw new Error(`unique violation on ${key}`);
          }
        }
        Object.assign(u, data);
        return u;
      }),
    },
    oAuthAccount: {
      findUnique: jest.fn(async ({ where }: { where: { provider_providerUserId: Partial<FakeAccount> } }) => {
        const a = accounts.find((x) => matches(x, where.provider_providerUserId));
        return a ? { ...a, user: findUser({ id: a.userId }) } : null;
      }),
      findFirst: jest.fn(
        async ({ where }: { where: Partial<FakeAccount> }) => accounts.find((a) => matches(a, where)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: Partial<FakeAccount> }) =>
        accounts.filter((a) => matches(a, where)),
      ),
      upsert: jest.fn(async ({ create }: { create: FakeAccount }) => {
        accounts.push({ ...create });
        return create;
      }),
      deleteMany: jest.fn(async ({ where }: { where: Partial<FakeAccount> }) => {
        for (let i = accounts.length - 1; i >= 0; i--)
          if (matches(accounts[i] as FakeAccount, where)) accounts.splice(i, 1);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Partial<FakeAccount>; data: Partial<FakeAccount> }) => {
        for (const a of accounts) if (matches(a, where)) Object.assign(a, data);
      }),
    },
    order: { count: jest.fn(async ({ where }: { where: { userId: string } }) => orders[where.userId] ?? 0) },
    device: { create: jest.fn(async () => ({ id: 'device-1' })) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(db)),
  };
  return db;
}

function customer(id: string, extra: Partial<FakeUser> = {}): FakeUser {
  return {
    id,
    role: Role.CUSTOMER,
    email: null,
    name: null,
    telegramUserId: null,
    blockedAt: null,
    locale: 'EN',
    ...extra,
  };
}

function setup(users: FakeUser[], accounts: FakeAccount[] = [], orders: Record<string, number> = {}) {
  const db = fakeDb(users, accounts, orders);
  const oauth = {
    verify: jest.fn(async (provider: 'GOOGLE' | 'APPLE') => ({
      provider,
      providerUserId: 'google-sub',
      email: 'ana@example.com',
      emailVerified: true,
      isPrivateEmail: false,
      name: 'Ana',
      locale: null,
    })),
    verifyTelegram: jest.fn(async () => ({ id: 777, firstName: 'Ana', lastName: null, username: null })),
  };
  const tokens = {
    issue: jest.fn(async () => ({
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresInSeconds: 1,
      refreshTokenExpiresInSeconds: 1,
    })),
  };
  const auth = { toAuthUser: jest.fn((u: FakeUser) => ({ id: u.id })) };
  const svc = new SignInMethodsService(
    db as unknown as PrismaService,
    oauth as unknown as OAuthIdentityService,
    tokens as unknown as TokensService,
    auth as unknown as AuthService,
  );
  return { svc, users, accounts };
}

describe('SignInMethodsService', () => {
  it('adds Google to a Telegram-only customer and fills in the missing email', async () => {
    const { svc, users } = setup([customer('tg', { telegramUserId: 777n })]);
    const result = await svc.linkOAuth('tg', 'GOOGLE', 'token');
    expect(result).toEqual({ methods: { telegram: true, google: true, apple: false } });
    expect(users[0]?.email).toBe('ana@example.com');
    expect(users[0]?.name).toBe('Ana');
  });

  it('takes the method away from another profile when that profile has no orders', async () => {
    const { svc, accounts } = setup(
      [customer('tg', { telegramUserId: 777n }), customer('empty-google')],
      [{ userId: 'empty-google', provider: 'GOOGLE', providerUserId: 'google-sub' }],
      { tg: 3 },
    );
    const result = await svc.linkOAuth('tg', 'GOOGLE', 'token');
    expect(result.session).toBeUndefined();
    expect(result.methods.google).toBe(true);
    expect(accounts).toEqual([{ userId: 'tg', provider: 'GOOGLE', providerUserId: 'google-sub' }]);
  });

  it('moves an empty profile into the one with orders and hands back its session', async () => {
    const { svc, users, accounts } = setup(
      [
        customer('apple-new', { email: 'relay@privaterelay.appleid.com' }),
        customer('tg-history', { telegramUserId: 777n }),
      ],
      [{ userId: 'apple-new', provider: 'APPLE', providerUserId: 'apple-sub' }],
      { 'tg-history': 5 },
    );
    const result = await svc.linkTelegram('apple-new', 'token');
    expect(result.session?.user).toEqual({ id: 'tg-history' });
    expect(result.methods).toEqual({ telegram: true, google: false, apple: true });
    expect(accounts[0]?.userId).toBe('tg-history');
    expect(users.find((u) => u.id === 'tg-history')?.email).toBe('relay@privaterelay.appleid.com');
    expect(users.find((u) => u.id === 'apple-new')?.email).toBeNull();
  });

  it('refuses to join two profiles that both have orders', async () => {
    const { svc } = setup(
      [customer('a', { telegramUserId: 777n }), customer('b')],
      [{ userId: 'b', provider: 'GOOGLE', providerUserId: 'google-sub' }],
      { a: 1, b: 1 },
    );
    await expect(svc.linkOAuth('a', 'GOOGLE', 'token')).rejects.toBeInstanceOf(ConflictException);
  });

  it('never links a social login to a staff account', async () => {
    const { svc } = setup([customer('staff', { role: Role.BRAND_ADMIN })]);
    await expect(svc.linkOAuth('staff', 'GOOGLE', 'token')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a second, different Google account on the same profile', async () => {
    const { svc } = setup(
      [customer('tg', { telegramUserId: 777n })],
      [{ userId: 'tg', provider: 'GOOGLE', providerUserId: 'another-google' }],
    );
    await expect(svc.linkOAuth('tg', 'GOOGLE', 'token')).rejects.toBeInstanceOf(ConflictException);
  });

  it('will not unlink the last way in', async () => {
    const { svc } = setup([customer('g')], [{ userId: 'g', provider: 'GOOGLE', providerUserId: 'google-sub' }]);
    await expect(svc.unlink('g', 'GOOGLE')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unlinks Google while Telegram still leads in', async () => {
    const { svc } = setup(
      [customer('g', { telegramUserId: 777n })],
      [{ userId: 'g', provider: 'GOOGLE', providerUserId: 'google-sub' }],
    );
    await expect(svc.unlink('g', 'GOOGLE')).resolves.toEqual({ telegram: true, google: false, apple: false });
  });
});
