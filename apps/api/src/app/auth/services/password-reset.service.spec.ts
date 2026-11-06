import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import type { MailService } from '../../mail/mail.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { BotKeyboard, TelegramBotApi } from '../../telegram-bot/telegram-bot-api.service';
import { passwordResetTelegramMessage } from './password-reset-message';
import {
  PASSWORD_RESET_COOLDOWN_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  PasswordResetService,
} from './password-reset.service';
import { PasswordService } from './password.service';
import { MemoryRedis } from './testing/memory-redis';
import type { TokensService } from './tokens.service';

interface Account {
  id: string;
  email: string | null;
  login: string | null;
  role: Role;
  blockedAt: Date | null;
  telegramNotifyChatId: bigint | null;
}

interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

const OWNER: Account = {
  id: 'owner',
  email: 'owner@noname.md',
  login: null,
  role: Role.BRAND_ADMIN,
  blockedAt: null,
  telegramNotifyChatId: 777n,
};
const BARISTA: Account = {
  id: 'barista',
  email: null,
  login: 'ion.barista',
  role: Role.STAFF,
  blockedAt: null,
  telegramNotifyChatId: 555n,
};

const PROD: Record<string, string> = { NODE_ENV: 'production', ADMIN_APP_URL: 'https://admin.takeaway.md/' };

/** The deliveries run after the answer; mocked transports settle within a few ticks. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function build(opts: { env?: Record<string, string>; smtp?: boolean; bot?: boolean; accounts?: Account[] } = {}) {
  const env = opts.env ?? PROD;
  const accounts = opts.accounts ?? [OWNER, BARISTA];
  const tokensTable: TokenRow[] = [];
  let nextToken = 1;
  const users = new Map<string, { passwordHash: string | null; passwordMustChange: boolean }>();

  const db = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; login?: string } }) => {
        const found = accounts.find((a) => (where.email ? a.email === where.email : a.login === where.login));
        return found ? { ...found } : null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { passwordHash: string } }) => {
        users.set(where.id, { passwordHash: data.passwordHash, passwordMustChange: false });
        return {};
      }),
    },
    passwordResetToken: {
      create: jest.fn(async ({ data }: { data: Omit<TokenRow, 'id' | 'consumedAt'> }) => {
        const row = { ...data, id: `t${nextToken++}`, consumedAt: null };
        tokensTable.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          tokensTable.find((t) => t.tokenHash === where.tokenHash) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; userId?: string; consumedAt: null };
          data: { consumedAt: Date };
        }) => {
          const hit = tokensTable.filter(
            (t) =>
              t.consumedAt === null &&
              (where.id ? t.id === where.id : true) &&
              (where.userId ? t.userId === where.userId : true),
          );
          for (const t of hit) t.consumedAt = data.consumedAt;
          return { count: hit.length };
        },
      ),
    },
  };
  const prisma = {
    ...db,
    $transaction: jest.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
  };
  const mail = {
    isConfigured: jest.fn(() => opts.smtp ?? true),
    sendPasswordReset: jest.fn<Promise<boolean>, [string, string, number]>(async () => true),
  };
  const bot = {
    isConfigured: jest.fn(() => opts.bot ?? true),
    sendMessage: jest.fn<Promise<boolean>, [bigint | number, string, BotKeyboard?]>(async () => true),
  };
  const tokens = { revokeAll: jest.fn(async () => 1) };
  const redis = new MemoryRedis();
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const passwords = new PasswordService();
  const service = new PasswordResetService(
    prisma as unknown as PrismaService,
    passwords,
    tokens as unknown as TokensService,
    mail as unknown as MailService,
    bot as unknown as TelegramBotApi,
    redis.asService(),
    config,
  );
  return { service, prisma, mail, bot, tokens, redis, tokensTable, users, passwords };
}

/** The raw token from the link a transport was handed. */
function tokenOf(url: string): string {
  return new URL(url).searchParams.get('token') ?? '';
}

describe('PasswordResetService.request — email and Telegram', () => {
  it('sends the same one-time link by email and to the linked Telegram chat', async () => {
    const { service, mail, bot, tokensTable } = build();
    const before = Date.now();

    const answer = await service.request(' Owner@NoName.md ');
    await flush();

    expect(answer).toEqual({ channels: ['email', 'telegram'], linkTtlMinutes: 60 });
    expect(tokensTable).toHaveLength(1);
    const [to, mailedUrl, ttl] = mail.sendPasswordReset.mock.calls[0] ?? [];
    expect(to).toBe('owner@noname.md');
    expect(ttl).toBe(60);
    expect(mailedUrl).toMatch(/^https:\/\/admin\.takeaway\.md\/reset-password\?token=[A-Za-z0-9_-]{43}$/);

    const [chatId, text, keyboard] = bot.sendMessage.mock.calls[0] ?? [];
    expect(chatId).toBe(777n);
    expect(text).toContain(mailedUrl);
    expect(text).toContain('Сброс пароля takeAway');
    expect(text).toContain('действует 60 минут');
    expect(text).toContain('Если это были не вы — просто проигнорируйте');
    expect(text).toContain('owner@noname.md');
    expect(keyboard).toEqual({ inline_keyboard: [[{ text: 'Задать новый пароль', url: mailedUrl }]] });

    // One token for both, stored only as its hash, working for an hour.
    const stored = tokensTable[0] as TokenRow;
    expect(stored.tokenHash).toBe(new PasswordService().hashResetToken(tokenOf(mailedUrl ?? '')));
    expect(stored.tokenHash).not.toContain(tokenOf(mailedUrl ?? ''));
    const ttlMs = stored.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThanOrEqual(PASSWORD_RESET_TTL_SECONDS * 1000);
    expect(ttlMs).toBeLessThan(PASSWORD_RESET_TTL_SECONDS * 1000 + 5_000);
  });

  it('takes a staff login too, and a login-only account gets the link in Telegram', async () => {
    const { service, mail, bot, prisma } = build();

    await service.request('Ion.Barista');
    await flush();

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { login: 'ion.barista' } }));
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage.mock.calls[0]?.[0]).toBe(555n);
    expect(bot.sendMessage.mock.calls[0]?.[1]).toContain('ion.barista');
  });

  it('without SMTP skips the email, sends Telegram and says only Telegram works — no 500, no letter promised', async () => {
    const { service, mail, bot } = build({ smtp: false });

    const answer = await service.request('owner@noname.md');
    await flush();

    expect(answer).toEqual({ channels: ['telegram'], linkTtlMinutes: 60 });
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('without the bot sends only the email', async () => {
    const { service, mail, bot } = build({ bot: false });

    const answer = await service.request('owner@noname.md');
    await flush();

    expect(answer.channels).toEqual(['email']);
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing — and keeps no token — to an account with no channel the server can use', async () => {
    const emailOnly: Account = { ...OWNER, id: 'mail-only', email: 'mail@noname.md', telegramNotifyChatId: null };
    const { service, mail, bot, tokensTable } = build({ smtp: false, accounts: [emailOnly] });

    await expect(service.request('mail@noname.md')).resolves.toEqual({ channels: ['telegram'], linkTtlMinutes: 60 });
    await flush();

    expect(tokensTable).toHaveLength(0);
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('answers the same for unknown, customer, blocked and channel-less accounts as for a real one', async () => {
    const customer: Account = { ...OWNER, id: 'c', email: 'guest@noname.md', role: Role.CUSTOMER };
    const blocked: Account = { ...OWNER, id: 'b', email: 'gone@noname.md', blockedAt: new Date() };
    const silent: Account = { ...BARISTA, id: 's', login: 'no.channels', telegramNotifyChatId: null };
    const { service, mail, bot, tokensTable } = build({ accounts: [OWNER, customer, blocked, silent] });

    const real = await service.request('owner@noname.md');
    await flush();
    mail.sendPasswordReset.mockClear();
    bot.sendMessage.mockClear();
    const created = tokensTable.length;

    for (const identifier of [
      'nobody@noname.md',
      'no.such.login',
      'guest@noname.md',
      'gone@noname.md',
      'no.channels',
    ]) {
      await expect(service.request(identifier)).resolves.toEqual(real);
    }
    await flush();
    expect(tokensTable).toHaveLength(created);
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('answers 503 PASSWORD_RESET_UNAVAILABLE with neither SMTP nor the bot, before looking anyone up', async () => {
    const { service, prisma } = build({ smtp: false, bot: false });

    const error = (await service.request('owner@noname.md').catch((e: unknown) => e)) as HttpException;

    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ code: 'PASSWORD_RESET_UNAVAILABLE' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('answers 503 in production without ADMIN_APP_URL instead of sending a localhost link', async () => {
    const { service, mail, bot } = build({ env: { NODE_ENV: 'production' } });

    const error = (await service.request('owner@noname.md').catch((e: unknown) => e)) as HttpException;

    expect(error.getStatus()).toBe(503);
    await flush();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('links to the local admin outside production, with the link in the text and no button Telegram would refuse', async () => {
    const { service, mail, bot } = build({ env: {} });

    await service.request('owner@noname.md');
    await flush();

    const url = mail.sendPasswordReset.mock.calls[0]?.[1] ?? '';
    expect(url).toMatch(/^http:\/\/localhost:4202\/reset-password\?token=/);
    expect(bot.sendMessage.mock.calls[0]?.[1]).toContain(url);
    expect(bot.sendMessage.mock.calls[0]?.[2]).toBeUndefined();
  });

  it('sends an account at most one link a minute, whoever asks', async () => {
    const { service, mail, bot, tokensTable, redis } = build();

    await service.request('owner@noname.md');
    const second = await service.request('owner@noname.md');
    await flush();

    expect(second).toEqual({ channels: ['email', 'telegram'], linkTtlMinutes: 60 });
    expect(tokensTable).toHaveLength(1);
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);

    redis.advance(PASSWORD_RESET_COOLDOWN_SECONDS + 1);
    await service.request('owner@noname.md');
    await flush();
    expect(tokensTable).toHaveLength(2);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('still sends when Redis is down: the per-client limit holds anyway', async () => {
    const { service, bot, redis } = build();
    redis.raw.set = jest.fn(async () => {
      throw new Error('redis down');
    });

    await service.request('owner@noname.md');
    await flush();

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('answers before the transports finish, and a failing one breaks nothing', async () => {
    const { service, mail, bot } = build();
    let release: (sent: boolean) => void = () => undefined;
    bot.sendMessage.mockImplementation(() => new Promise<boolean>((resolve) => (release = resolve)));
    mail.sendPasswordReset.mockResolvedValue(false);

    await expect(service.request('owner@noname.md')).resolves.toMatchObject({ channels: ['email', 'telegram'] });
    release(false);
    await flush();
  });

  it('never writes the link into the log', async () => {
    const logged: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(String(args[0]));
      }),
    );
    try {
      const { service, mail } = build();
      await service.request('owner@noname.md');
      await flush();
      const token = tokenOf(mail.sendPasswordReset.mock.calls[0]?.[1] ?? '');

      expect(logged.join('\n')).toContain('email sent, Telegram sent');
      expect(logged.join('\n')).not.toContain(token);
      expect(logged.join('\n')).not.toContain('reset-password');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('PasswordResetService.reset', () => {
  async function linkFor(identifier: string) {
    const built = build();
    await built.service.request(identifier);
    await flush();
    const url = built.mail.sendPasswordReset.mock.calls[0]?.[1] ?? '';
    return { ...built, token: tokenOf(url) };
  }

  it('sets the password from the link — email or Telegram, the same token — and signs out everywhere', async () => {
    const { service, users, tokens, bot, token } = await linkFor('owner@noname.md');
    expect(tokenOf((bot.sendMessage.mock.calls[0]?.[1] ?? '').match(/https:\S+/)?.[0] ?? '')).toBe(token);

    await service.reset(token, 'a-brand-new-password');

    expect(users.get('owner')).toEqual({
      passwordHash: expect.stringMatching(/^\$2[aby]\$/),
      passwordMustChange: false,
    });
    expect(tokens.revokeAll).toHaveBeenCalledWith('owner');
  });

  it('works once: the same link again is refused', async () => {
    const { service, token } = await linkFor('owner@noname.md');
    await service.reset(token, 'a-brand-new-password');

    await expect(service.reset(token, 'another-password-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an expired link and changes nothing', async () => {
    const { service, token, tokensTable, users, tokens } = await linkFor('owner@noname.md');
    (tokensTable[0] as TokenRow).expiresAt = new Date(Date.now() - 1);

    await expect(service.reset(token, 'a-brand-new-password')).rejects.toThrow('Reset link is invalid or has expired');
    expect(users.size).toBe(0);
    expect(tokens.revokeAll).not.toHaveBeenCalled();
  });

  it('refuses a link nobody issued', async () => {
    const { service } = build();
    await expect(service.reset('x'.repeat(43), 'a-brand-new-password')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('turns off every other unused link of the account with it', async () => {
    const { service, token, tokensTable, redis } = await linkFor('owner@noname.md');
    redis.advance(PASSWORD_RESET_COOLDOWN_SECONDS + 1);
    await service.request('owner@noname.md');
    expect(tokensTable).toHaveLength(2);

    await service.reset(token, 'a-brand-new-password');

    expect(tokensTable.every((t) => t.consumedAt !== null)).toBe(true);
  });

  it('changes the password once when the same link is used twice at the same moment', async () => {
    const { service, token, prisma, users } = await linkFor('owner@noname.md');
    // The other request claimed it between the lookup and the transaction.
    prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.reset(token, 'a-brand-new-password')).rejects.toBeInstanceOf(BadRequestException);
    expect(users.size).toBe(0);
  });
});

describe('passwordResetTelegramMessage', () => {
  it('names the account, the time limit and what to do if it was not you, in Russian then English', () => {
    const { text, keyboard } = passwordResetTelegramMessage({
      url: 'https://admin.takeaway.md/reset-password?token=abc',
      account: 'ion.barista',
      ttlMinutes: 60,
    });
    expect(text.split('\n')[0]).toBe('Сброс пароля takeAway');
    expect(text).toContain('Для аккаунта ion.barista запросили сброс пароля');
    expect(text).toContain(
      'она действует 60 минут и сработает один раз:\nhttps://admin.takeaway.md/reset-password?token=abc',
    );
    expect(text).toContain('Если это были не вы — просто проигнорируйте это сообщение');
    expect(text).toContain('takeAway password reset for ion.barista: open the link within 60 minutes');
    expect(keyboard?.inline_keyboard[0]?.[0]).toEqual({
      text: 'Задать новый пароль',
      url: 'https://admin.takeaway.md/reset-password?token=abc',
    });
  });

  it('says «вашего аккаунта» when the account has neither an email nor a login', () => {
    const { text } = passwordResetTelegramMessage({ url: 'https://a/b', account: '', ttlMinutes: 60 });
    expect(text).toContain('Для вашего аккаунта запросили');
  });
});
