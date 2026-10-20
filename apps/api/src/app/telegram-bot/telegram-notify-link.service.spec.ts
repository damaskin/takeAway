import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import { MemoryRedis } from '../auth/services/testing/memory-redis';
import type { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_LINK_TTL_SECONDS, TelegramNotifyLinkService } from './telegram-notify-link.service';

/** Everything the bot link needs on a server where it works. */
const READY = {
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_BOT_USERNAME: '@takaway_tgbot',
  TELEGRAM_WEBHOOK_URL: 'https://api.takeaway.md/api/telegram/webhook',
  TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
};

interface Account {
  id: string;
  role: Role;
  blockedAt: Date | null;
  name: string | null;
  login: string | null;
  email: string | null;
  telegramNotifyChatId: bigint | null;
  telegramUserId: bigint | null;
}

function setup(env: Record<string, string> = READY) {
  const accounts: Account[] = [
    {
      id: 'barista',
      role: Role.STAFF,
      blockedAt: null,
      name: 'Ира',
      login: null,
      email: null,
      telegramNotifyChatId: null,
      telegramUserId: 555n,
    },
    {
      id: 'customer',
      role: Role.CUSTOMER,
      blockedAt: null,
      name: 'Гость',
      login: null,
      email: null,
      telegramNotifyChatId: null,
      telegramUserId: 777n,
    },
  ];
  const prisma = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => accounts.find((a) => a.id === where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Account> }) => {
        const account = accounts.find((a) => a.id === where.id);
        if (account) Object.assign(account, data);
        return account;
      }),
    },
  };
  const redis = new MemoryRedis();
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const service = new TelegramNotifyLinkService(prisma as unknown as PrismaService, redis.asService(), config);
  return { service, redis, accounts, prisma };
}

/** The code inside a `https://t.me/<bot>?start=link_<code>` link. */
const codeOf = (url: string): string => new URL(url).searchParams.get('start')?.replace(/^link_/, '') ?? '';

describe('TelegramNotifyLinkService', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('hands out a one-time t.me link for ten minutes and keeps only a hash of its code', async () => {
    const { service, redis } = setup();
    const link = await service.issue('barista');

    expect(link.url).toMatch(/^https:\/\/t\.me\/takaway_tgbot\?start=link_[A-Za-z0-9_-]{22}$/);
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeGreaterThan((NOTIFY_LINK_TTL_SECONDS - 5) * 1000);
    const stored = redis
      .dump()
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    expect(stored).not.toContain(codeOf(link.url));
  });

  it('refuses with 503 TELEGRAM_NOTIFY_LINK_UNAVAILABLE while the bot cannot hear the link', async () => {
    for (const missing of ['TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_URL', 'TELEGRAM_WEBHOOK_SECRET']) {
      const env: Record<string, string> = { ...READY };
      delete env[missing];
      const { service } = setup(env);
      const error = (await service.issue('barista').catch((e: unknown) => e)) as HttpException;
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toMatchObject({ code: 'TELEGRAM_NOTIFY_LINK_UNAVAILABLE' });
      await expect(service.status('barista')).resolves.toEqual({ linked: false, botLinkAvailable: false });
    }
  });

  it('links the chat the code came from — once — and leaves the Telegram sign-in alone', async () => {
    const { service, accounts } = setup();
    const link = await service.issue('barista');

    await expect(service.consume(codeOf(link.url), 9001n)).resolves.toEqual({ userId: 'barista', name: 'Ира' });
    expect(accounts[0]).toMatchObject({ telegramNotifyChatId: 9001n, telegramUserId: 555n });
    await expect(service.status('barista')).resolves.toEqual({ linked: true, botLinkAvailable: true });

    // The same link opened again links nothing.
    await expect(service.consume(codeOf(link.url), 9002n)).resolves.toBeNull();
    expect(accounts[0]?.telegramNotifyChatId).toBe(9001n);
  });

  it('forgets a code after ten minutes, and the previous code when a new one is made', async () => {
    const { service, redis } = setup();
    const first = await service.issue('barista');
    const second = await service.issue('barista');
    await expect(service.consume(codeOf(first.url), 1n)).resolves.toBeNull();

    redis.advance(NOTIFY_LINK_TTL_SECONDS + 1);
    await expect(service.consume(codeOf(second.url), 1n)).resolves.toBeNull();
  });

  it('refuses a malformed code without looking it up', async () => {
    const { service, prisma } = setup();
    await expect(service.consume('bad code!', 1n)).resolves.toBeNull();
    await expect(service.consume('short', 1n)).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('links no customer and no blocked account, even with a valid code', async () => {
    const { service, accounts } = setup();
    const customer = await service.issue('customer');
    await expect(service.consume(codeOf(customer.url), 1n)).resolves.toBeNull();
    expect(accounts[1]?.telegramNotifyChatId).toBeNull();

    const barista = await service.issue('barista');
    if (accounts[0]) accounts[0].blockedAt = new Date();
    await expect(service.consume(codeOf(barista.url), 1n)).resolves.toBeNull();
    expect(accounts[0]?.telegramNotifyChatId).toBeNull();
  });

  it('«Отвязать» stops the notifications and voids a link still pending', async () => {
    const { service, accounts } = setup();
    const linked = await service.issue('barista');
    await service.consume(codeOf(linked.url), 9001n);
    const pending = await service.issue('barista');

    await expect(service.unlink('barista')).resolves.toEqual({ linked: false, botLinkAvailable: true });
    expect(accounts[0]?.telegramNotifyChatId).toBeNull();
    expect(accounts[0]?.telegramUserId).toBe(555n);
    await expect(service.consume(codeOf(pending.url), 9001n)).resolves.toBeNull();
  });
});
