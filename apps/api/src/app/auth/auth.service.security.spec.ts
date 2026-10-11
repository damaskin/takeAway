import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { KdsPinService } from './services/kds-pin.service';
import type { OAuthIdentity, OAuthIdentityService } from './services/oauth-identity.service';
import type { PasswordService } from './services/password.service';
import type { TelegramService } from './services/telegram.service';
import type { TokensService } from './services/tokens.service';

interface Row {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: Role;
  name: string | null;
  blockedAt: Date | null;
  phone: string | null;
  locale: string;
  currency: string;
  telegramUserId: bigint | null;
  passwordHash: string | null;
  passwordMustChange: boolean;
}

interface Account {
  provider: string;
  providerUserId: string;
  userId: string;
}

function row(id: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    email: null,
    emailVerifiedAt: null,
    role: Role.CUSTOMER,
    name: null,
    blockedAt: null,
    phone: null,
    locale: 'EN',
    currency: 'USD',
    telegramUserId: null,
    passwordHash: null,
    passwordMustChange: false,
    ...extra,
  };
}

/** Users and OAuth accounts in memory, with the queries the sign-in and password paths run. */
function harness(seed: Row[] = [], accounts: Account[] = []) {
  const users = new Map(seed.map((u) => [u.id, u]));
  let nextId = 1;
  const byWhere = (where: { id?: string; email?: string }) =>
    [...users.values()].find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null;

  const tx = {
    oAuthAccount: {
      findUnique: jest.fn(
        async ({ where }: { where: { provider_providerUserId: { provider: string; providerUserId: string } } }) => {
          const key = where.provider_providerUserId;
          const account = accounts.find((a) => a.provider === key.provider && a.providerUserId === key.providerUserId);
          return account ? { ...account, user: users.get(account.userId) } : null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Account }) => {
        accounts.push(data);
        return data;
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) => byWhere(where)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(users.get(where.id) as Row, data),
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Partial<Row> & { oauthAccounts: { create: { provider: string; providerUserId: string } } };
        }) => {
          const { oauthAccounts, ...fields } = data;
          if (fields.email && byWhere({ email: fields.email })) throw new Error('unique violation on email');
          const user = row(`new-${nextId++}`, fields);
          users.set(user.id, user);
          accounts.push({ ...oauthAccounts.create, userId: user.id });
          return user;
        },
      ),
    },
  };
  const prisma = {
    ...tx,
    device: { create: jest.fn(async () => ({ id: 'device-1' })) },
    passwordResetToken: {
      findUnique: jest.fn(),
      update: jest.fn(async () => ({})),
    },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const tokens = {
    issue: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })),
    revokeAll: jest.fn(async () => 1),
  };
  const passwords = {
    compare: jest.fn(async (plain: string) => plain === 'old-password'),
    hash: jest.fn(async () => 'new-hash'),
    hashResetToken: jest.fn((raw: string) => `hash-of-${raw}`),
  };
  const oauth = { verify: jest.fn<Promise<OAuthIdentity>, [string, string]>() };
  const auth = new AuthService(
    prisma as unknown as PrismaService,
    {} as UsersService,
    tokens as unknown as TokensService,
    {} as TelegramService,
    oauth as unknown as OAuthIdentityService,
    passwords as unknown as PasswordService,
    {} as KdsPinService,
    {} as MailService,
    { get: () => undefined } as unknown as ConfigService,
  );
  return { auth, users, accounts, prisma, tokens, oauth };
}

const google = (email: string | null, emailVerified = true, sub = 'g-ana'): OAuthIdentity => ({
  provider: 'GOOGLE',
  providerUserId: sub,
  email,
  emailVerified,
  isPrivateEmail: false,
  name: 'Ana',
  locale: 'ru',
});

describe('AuthService social sign-in by email', () => {
  it('does not walk into a profile that only typed the address in', async () => {
    // Mallory put Ana's address on her own profile and waited.
    const { auth, users, accounts, oauth } = harness([row('mallory', { email: 'ana@gmail.com' })]);
    oauth.verify.mockResolvedValue(google('Ana@Gmail.com'));

    const session = await auth.loginWithOAuth('GOOGLE', 'id-token');

    expect(session.user.id).not.toBe('mallory');
    expect(accounts.find((a) => a.providerUserId === 'g-ana')?.userId).toBe(session.user.id);
    // The address belongs to whoever proved it, and is proven on the new profile.
    expect(users.get('mallory')?.email).toBeNull();
    expect(users.get(session.user.id)).toMatchObject({ email: 'ana@gmail.com', emailVerifiedAt: expect.any(Date) });
  });

  it('joins a profile whose address a provider has already proven', async () => {
    const proven = new Date('2026-09-01T00:00:00Z');
    const { auth, accounts, oauth, users } = harness([
      row('ana', { email: 'ana@gmail.com', emailVerifiedAt: proven, name: null }),
    ]);
    oauth.verify.mockResolvedValue({ ...google('ana@gmail.com', true, 'apple-ana'), provider: 'APPLE' });

    const session = await auth.loginWithOAuth('APPLE', 'id-token');

    expect(session.user.id).toBe('ana');
    expect(accounts).toEqual([{ provider: 'APPLE', providerUserId: 'apple-ana', userId: 'ana' }]);
    expect(users.size).toBe(1);
  });

  it('never joins a staff account, proven or not', async () => {
    const { auth, accounts, oauth } = harness([
      row('owner', { email: 'owner@brand.example', emailVerifiedAt: new Date(), role: Role.BRAND_ADMIN }),
    ]);
    oauth.verify.mockResolvedValue(google('owner@brand.example'));

    await expect(auth.loginWithOAuth('GOOGLE', 'id-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accounts).toEqual([]);
  });

  it('keeps an address the provider does not vouch for, unproven, and only while nobody has it', async () => {
    const { auth, users, oauth } = harness([row('ana', { email: 'ana@gmail.com', emailVerifiedAt: new Date() })]);
    oauth.verify.mockResolvedValueOnce(google('ana@gmail.com', false, 'g-other'));
    const taken = await auth.loginWithOAuth('GOOGLE', 'id-token');
    expect(taken.user.id).not.toBe('ana');
    expect(users.get(taken.user.id)).toMatchObject({ email: null, emailVerifiedAt: null });
    expect(users.get('ana')?.email).toBe('ana@gmail.com');

    oauth.verify.mockResolvedValueOnce(google('free@example.com', false, 'g-free'));
    const free = await auth.loginWithOAuth('GOOGLE', 'id-token');
    expect(users.get(free.user.id)).toMatchObject({ email: 'free@example.com', emailVerifiedAt: null });
  });

  it('proves the address on the profile when the provider vouches for it on a later sign-in', async () => {
    const { auth, users, oauth } = harness(
      [row('ana', { email: 'ana@gmail.com' })],
      [{ provider: 'GOOGLE', providerUserId: 'g-ana', userId: 'ana' }],
    );
    oauth.verify.mockResolvedValue(google('ana@gmail.com'));

    await auth.loginWithOAuth('GOOGLE', 'id-token');

    expect(users.get('ana')?.emailVerifiedAt).toBeInstanceOf(Date);
  });
});

describe('AuthService password changes end other sessions', () => {
  it('a password change revokes every other session and spares the caller’s', async () => {
    const { auth, tokens, users } = harness([row('barista', { role: Role.STAFF, passwordHash: 'old-hash' })]);

    await auth.changeOwnPassword('barista', 'old-password', 'new-password-1', 'refresh-of-this-tab');

    expect(users.get('barista')?.passwordHash).toBe('new-hash');
    expect(tokens.revokeAll).toHaveBeenCalledWith('barista', 'refresh-of-this-tab');
  });

  it('a wrong current password changes nothing and revokes nothing', async () => {
    const { auth, tokens } = harness([row('barista', { role: Role.STAFF, passwordHash: 'old-hash' })]);

    await expect(auth.changeOwnPassword('barista', 'guess', 'new-password-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.revokeAll).not.toHaveBeenCalled();
  });

  it('a reset from the emailed link signs the account out everywhere', async () => {
    const { auth, tokens, prisma } = harness([row('barista', { role: Role.STAFF, passwordHash: 'old-hash' })]);
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: 'barista',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await auth.resetPassword('raw-token', 'new-password-1');

    expect(tokens.revokeAll).toHaveBeenCalledWith('barista');
  });
});
