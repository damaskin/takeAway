import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { KdsPinService } from './services/kds-pin.service';
import type { KitchenDeviceService } from './services/kitchen-device.service';
import type { OAuthIdentityService } from './services/oauth-identity.service';
import type { PasswordService } from './services/password.service';
import type { TelegramService } from './services/telegram.service';
import type { TokensService } from './services/tokens.service';

interface Row {
  id: string;
  email: string | null;
  login: string | null;
  role: Role;
  name: string | null;
  phone: string | null;
  locale: string;
  currency: string;
  telegramUserId: bigint | null;
  passwordHash: string | null;
  passwordMustChange: boolean;
  blockedAt: Date | null;
}

function row(id: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    email: null,
    login: null,
    role: Role.STAFF,
    name: null,
    phone: null,
    locale: 'RU',
    currency: 'USD',
    telegramUserId: null,
    passwordHash: 'hash-of-right-password',
    passwordMustChange: false,
    blockedAt: null,
    ...extra,
  };
}

function harness(seed: Row[]) {
  const findUnique = jest.fn(
    async ({ where }: { where: { email?: string; login?: string } }) =>
      seed.find((u) => (where.email !== undefined ? u.email === where.email : u.login === where.login)) ?? null,
  );
  const prisma = {
    user: { findUnique },
    device: { create: jest.fn(async () => ({ id: 'device-1' })) },
  };
  const tokens = { issue: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })) };
  const passwords = {
    compare: jest.fn(async (plain: string) => plain === 'right-password'),
    compareWithoutAccount: jest.fn(async () => undefined),
  };
  const auth = new AuthService(
    prisma as unknown as PrismaService,
    {} as UsersService,
    tokens as unknown as TokensService,
    {} as TelegramService,
    {} as OAuthIdentityService,
    passwords as unknown as PasswordService,
    {} as KdsPinService,
    {} as MailService,
    { get: () => undefined } as unknown as ConfigService,
    {} as KitchenDeviceService,
  );
  return { auth, findUnique, tokens, passwords };
}

const manager = row('manager', { email: 'manager@noname.md', role: Role.STORE_MANAGER });
const barista = row('barista', { login: 'anna.k', name: 'Anna', passwordMustChange: true });

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UnauthorizedException);
  return (error as UnauthorizedException).message;
}

describe('AuthService.loginWithPassword — by email or by login', () => {
  it('signs in by email, whatever its case', async () => {
    const { auth, findUnique } = harness([manager, barista]);
    const session = await auth.loginWithPassword('Manager@NoName.md', 'right-password');
    expect(session.user).toMatchObject({ id: 'manager', email: 'manager@noname.md', login: null });
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'manager@noname.md' } });
  });

  it('signs in by login, case-insensitively, and still asks for the temporary password to be changed', async () => {
    const { auth, findUnique } = harness([manager, barista]);
    const session = await auth.loginWithPassword(' Anna.K ', 'right-password');
    expect(session.user).toMatchObject({ id: 'barista', login: 'anna.k', email: null });
    expect(session.mustChangePassword).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { login: 'anna.k' } });
  });

  it('gives an unknown login, an unknown email and a wrong password the same answer', async () => {
    const { auth, tokens } = harness([manager, barista]);
    const unknownLogin = await failure(auth.loginWithPassword('nobody', 'right-password'));
    const unknownEmail = await failure(auth.loginWithPassword('nobody@noname.md', 'right-password'));
    const wrongPassword = await failure(auth.loginWithPassword('anna.k', 'wrong-password'));
    const empty = await failure(auth.loginWithPassword('', 'right-password'));
    expect(new Set([unknownLogin, unknownEmail, wrongPassword, empty]).size).toBe(1);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('spends a bcrypt compare on an unknown account too, so timing does not reveal it', async () => {
    const { auth, passwords } = harness([manager, barista]);
    await failure(auth.loginWithPassword('nobody', 'some-password'));
    await failure(auth.loginWithPassword('nobody@noname.md', 'some-password'));
    expect(passwords.compareWithoutAccount).toHaveBeenCalledTimes(2);
    expect(passwords.compare).not.toHaveBeenCalled();
  });

  it('never looks a login up among emails, nor an email among logins', async () => {
    // A login and an email with the same text can't both exist, but the
    // lookup must not depend on that: the '@' alone picks the column.
    const { auth, findUnique } = harness([row('odd', { email: 'anna.k', login: null })]);
    await failure(auth.loginWithPassword('anna.k', 'right-password'));
    expect(findUnique).toHaveBeenCalledWith({ where: { login: 'anna.k' } });
  });

  it('still refuses a customer and a blocked account', async () => {
    const { auth } = harness([
      row('customer', { login: 'guest', role: Role.CUSTOMER }),
      row('gone', { login: 'gone', blockedAt: new Date() }),
    ]);
    await failure(auth.loginWithPassword('guest', 'right-password'));
    expect(await failure(auth.loginWithPassword('gone', 'right-password'))).toBe('Account is blocked');
  });
});
