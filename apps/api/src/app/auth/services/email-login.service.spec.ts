import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import type { MailService, OutgoingMail } from '../../mail/mail.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthService } from '../auth.service';
import { EmailCodeService } from './email-code.service';
import { EmailLoginService } from './email-login.service';
import { MemoryRedis } from './testing/memory-redis';
import type { TokensService } from './tokens.service';

interface Row {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: Role;
  locale: 'EN' | 'RU';
  blockedAt: Date | null;
}

function row(id: string, extra: Partial<Row> = {}): Row {
  return { id, email: null, emailVerifiedAt: null, role: Role.CUSTOMER, locale: 'EN', blockedAt: null, ...extra };
}

/** Users in memory with the queries the email sign-in runs; mail and tokens recorded. */
function setup(seed: Row[] = [], options: { smtp?: boolean; accepts?: boolean } = {}) {
  const users = new Map(seed.map((u) => [u.id, u]));
  let nextId = 1;
  const tx = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { email: string } }) =>
          [...users.values()].find((u) => u.email === where.email) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(users.get(where.id) as Row, data),
      ),
      create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
        if (data.email && [...users.values()].some((u) => u.email === data.email)) {
          throw new Error('unique violation on email');
        }
        const user = row(`new-${nextId++}`, data);
        users.set(user.id, user);
        return user;
      }),
    },
  };
  const prisma = {
    ...tx,
    device: { create: jest.fn(async () => ({ id: 'device-1' })) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const letters: Array<{ to: string; mail: OutgoingMail }> = [];
  const mail = {
    isConfigured: () => options.smtp ?? true,
    sendLoginCode: jest.fn(async (to: string, letter: OutgoingMail) => {
      letters.push({ to, mail: letter });
      return options.accepts ?? true;
    }),
  };
  const tokens = {
    issue: jest.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresInSeconds: 900,
      refreshTokenExpiresInSeconds: 604800,
    })),
  };
  const auth = { toAuthUser: (u: Row) => ({ id: u.id, email: u.email, role: u.role, locale: u.locale }) };
  const redis = new MemoryRedis();
  const codes = new EmailCodeService(redis.asService(), {
    get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'test-access-secret' : undefined),
  } as unknown as ConfigService);
  const service = new EmailLoginService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    codes,
    tokens as unknown as TokensService,
    auth as unknown as AuthService,
  );

  /** The six digits from the last letter. */
  const lastCode = (): string => {
    const match = /\b([0-9]{6})\b/.exec(letters.at(-1)?.mail.text ?? '');
    if (!match?.[1]) throw new Error('no code was mailed');
    return match[1];
  };
  /** Mails a code to `email` and returns it. */
  const codeFor = async (email: string, locale = 'en'): Promise<string> => {
    await service.start(email, locale);
    return lastCode();
  };
  return { service, users, prisma, mail, letters, tokens, codeFor };
}

async function failure(promise: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) {
      const body = err.getResponse();
      return {
        status: err.getStatus(),
        body: typeof body === 'string' ? { message: body } : (body as Record<string, unknown>),
      };
    }
    throw err;
  }
  throw new Error('expected the call to fail');
}

describe('EmailLoginService', () => {
  describe('start', () => {
    it('mails a short code in the customer’s language and never looks the address up', async () => {
      const { service, letters, prisma } = setup();

      await service.start('  Ivan@Mail.RU ', 'ru-RU');

      expect(letters).toHaveLength(1);
      const [{ to, mail }] = letters as [{ to: string; mail: OutgoingMail }];
      expect(to).toBe('ivan@mail.ru');
      expect(mail.subject).toBe('Код для входа в takeAway');
      expect(mail.text).toMatch(
        /^Код для входа в takeAway: [0-9]{6}\. Он действует 10 минут\.\n\nЕсли вы не запрашивали код — просто проигнорируйте письмо\.$/,
      );
      expect(mail.html).toContain('Он действует 10 минут.');
      // Whether a profile exists is never asked, so the answer cannot depend on it.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('writes in English otherwise, and keeps the code out of the subject (MailService logs subjects)', async () => {
      const { service, letters } = setup();

      await service.start('ana@example.com');

      const { mail } = letters[0] as { mail: OutgoingMail };
      expect(mail.subject).toBe('Your takeAway sign-in code');
      expect(mail.subject).not.toMatch(/[0-9]/);
      expect(mail.text).toMatch(/^Your takeAway sign-in code: [0-9]{6}\. It is valid for 10 minutes\./);
    });

    it('answers 503 EMAIL_LOGIN_UNAVAILABLE without SMTP and mails nothing', async () => {
      const { service, mail } = setup([], { smtp: false });

      const { status, body } = await failure(service.start('ivan@mail.ru', 'ru'));

      expect(status).toBe(503);
      expect(body).toMatchObject({ code: 'EMAIL_LOGIN_UNAVAILABLE' });
      expect(mail.sendLoginCode).not.toHaveBeenCalled();
      expect(service.isAvailable()).toBe(false);
    });

    it('says EMAIL_CODE_NOT_SENT when the mail server refuses, and lets the address ask again at once', async () => {
      const { service, mail } = setup([], { accepts: false });

      const { status, body } = await failure(service.start('ivan@mail.ru', 'ru'));
      expect(status).toBe(503);
      expect(body).toMatchObject({ code: 'EMAIL_CODE_NOT_SENT' });

      mail.sendLoginCode.mockResolvedValueOnce(true);
      await expect(service.start('ivan@mail.ru', 'ru')).resolves.toBeUndefined();
    });
  });

  describe('verify', () => {
    it('opens a new customer with a proven address and the language the code was asked in', async () => {
      const { service, users, tokens, codeFor } = setup();
      const code = await codeFor('Ivan@Mail.ru', 'ru');

      const session = await service.verify('ivan@mail.RU', code);

      expect(session).toMatchObject({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { email: 'ivan@mail.ru' },
      });
      const created = users.get(session.user.id);
      expect(created).toMatchObject({ email: 'ivan@mail.ru', role: Role.CUSTOMER, locale: 'RU' });
      expect(created?.emailVerifiedAt).toBeInstanceOf(Date);
      expect(tokens.issue).toHaveBeenCalledWith(session.user.id, 'device-1');
    });

    it('signs a customer whose address is proven into their own profile', async () => {
      const { service, users, prisma, codeFor } = setup([
        row('ana', { email: 'ana@mail.ru', emailVerifiedAt: new Date('2026-09-01') }),
      ]);

      const session = await service.verify('ana@mail.ru', await codeFor('ana@mail.ru'));

      expect(session.user.id).toBe('ana');
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(users.size).toBe(1);
    });

    it('does not walk into a profile that only typed the address in', async () => {
      // Mallory put Ana's address on her own profile and waited.
      const { service, users, codeFor } = setup([row('mallory', { email: 'ana@mail.ru' })]);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const session = await service.verify('ana@mail.ru', await codeFor('ana@mail.ru'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('profile mallory had only typed in'));
      warn.mockRestore();

      expect(session.user.id).not.toBe('mallory');
      expect(users.get('mallory')?.email).toBeNull();
      expect(users.get(session.user.id)).toMatchObject({ email: 'ana@mail.ru', emailVerifiedAt: expect.any(Date) });
    });

    it.each([Role.STAFF, Role.STORE_MANAGER, Role.MENU_EDITOR, Role.BRAND_ADMIN, Role.SUPER_ADMIN, Role.RIDER])(
      'never opens a %s account — 401 EMAIL_LOGIN_STAFF_ACCOUNT, as Google does',
      async (role) => {
        const { service, users, tokens, prisma, codeFor } = setup([
          row('staff', { email: 'owner@cafe.md', emailVerifiedAt: new Date(), role }),
        ]);

        const { status, body } = await failure(service.verify('owner@cafe.md', await codeFor('owner@cafe.md')));

        expect(status).toBe(401);
        expect(body).toMatchObject({ code: 'EMAIL_LOGIN_STAFF_ACCOUNT' });
        expect(tokens.issue).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(users.get('staff')?.email).toBe('owner@cafe.md');
      },
    );

    it('refuses a blocked customer', async () => {
      const { service, tokens, codeFor } = setup([
        row('ana', { email: 'ana@mail.ru', emailVerifiedAt: new Date(), blockedAt: new Date() }),
      ]);

      const { status } = await failure(service.verify('ana@mail.ru', await codeFor('ana@mail.ru')));

      expect(status).toBe(401);
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('touches no account for a wrong code', async () => {
      const { service, prisma, codeFor } = setup();
      const code = await codeFor('ivan@mail.ru');
      const wrong = code === '000000' ? '000001' : '000000';

      const { status, body } = await failure(service.verify('ivan@mail.ru', wrong));

      expect(status).toBe(400);
      expect(body).toMatchObject({ code: 'EMAIL_CODE_INVALID', attemptsLeft: 4 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a code works for its own address only', async () => {
      const { service, codeFor } = setup();
      const code = await codeFor('ivan@mail.ru');

      const { body } = await failure(service.verify('maria@mail.ru', code));

      expect(body).toMatchObject({ code: 'EMAIL_CODE_EXPIRED' });
    });

    it('answers 503 EMAIL_LOGIN_UNAVAILABLE without SMTP', async () => {
      const { service } = setup([], { smtp: false });

      const { status, body } = await failure(service.verify('ivan@mail.ru', '123456'));

      expect(status).toBe(503);
      expect(body).toMatchObject({ code: 'EMAIL_LOGIN_UNAVAILABLE' });
    });
  });
});
