import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { KdsSessionGuard } from '../auth/guards/kds-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemoryRedis } from '../auth/services/testing/memory-redis';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { TelegramBotApi } from './telegram-bot-api.service';
import { TelegramNotifyLinkController } from './telegram-notify-link.controller';
import { TelegramNotifyLinkService } from './telegram-notify-link.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';

const JWT_SECRET = 'test-access-secret';
const WEBHOOK_SECRET = 'webhook-secret-0123456789abcdef';
const ENV: Record<string, string> = {
  JWT_ACCESS_SECRET: JWT_SECRET,
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_BOT_USERNAME: 'takaway_tgbot',
  TELEGRAM_WEBHOOK_URL: 'https://api.takeaway.md/api/telegram/webhook',
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

interface Account {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  name: string | null;
  login: string | null;
  blockedAt: Date | null;
  kdsPinHash: string | null;
  kdsPinBrandId: string | null;
  kdsPinStoreId: string | null;
  telegramNotifyChatId: bigint | null;
}

/**
 * The bot over HTTP, through the real global guards (JWT, kitchen session,
 * roles) and the real strategy: the webhook is public and trusts only its
 * secret, and the «Telegram» page works from a kitchen PIN session.
 */
describe('Telegram bot endpoints', () => {
  let app: NestFastifyApplication;
  let jwt: JwtService;
  const accounts = new Map<string, Account>();
  const sendMessage = jest.fn().mockResolvedValue(true);
  const account = (id: string, role: Role, extra: Partial<Account> = {}): Account => ({
    id,
    role,
    email: null,
    phone: null,
    name: id,
    login: null,
    blockedAt: null,
    kdsPinHash: null,
    kdsPinBrandId: null,
    kdsPinStoreId: null,
    telegramNotifyChatId: null,
    ...extra,
  });
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => accounts.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Account> }) =>
        Object.assign(accounts.get(where.id) as Account, data),
      ),
    },
    // The barista works at store-1 of brand-1.
    userStore: {
      findMany: jest.fn(async ({ where }: { where: { userId: string; store: { brandId: string } } }) =>
        where.userId === 'barista' && where.store.brandId === 'brand-1' ? [{ storeId: 'store-1' }] : [],
      ),
    },
  };

  beforeAll(async () => {
    const redis = new MemoryRedis();
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: JWT_SECRET })],
      controllers: [TelegramWebhookController, TelegramNotifyLinkController],
      providers: [
        JwtStrategy,
        TelegramNotifyLinkService,
        TelegramWebhookService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: KdsSessionGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: ConfigService, useValue: { get: (key: string) => ENV[key] } },
        { provide: UsersService, useValue: { findById: async (id: string) => accounts.get(id) ?? null } },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis.asService() },
        { provide: TelegramBotApi, useValue: { sendMessage } },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    accounts.clear();
    accounts.set(
      'barista',
      account('barista', Role.STAFF, { name: 'Ира', kdsPinHash: 'hash', kdsPinBrandId: 'brand-1' }),
    );
    accounts.set('customer', account('customer', Role.CUSTOMER));
    jest.clearAllMocks();
  });

  /** A kitchen PIN session on a brand-1 tablet. */
  const pinSession = () => jwt.signAsync({ sub: 'barista', jti: 'pin', kdsb: 'brand-1', kds: 'store-1' });
  const webhook = (secret: string | undefined, text: string) =>
    app.inject({
      method: 'POST',
      url: '/telegram/webhook',
      headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
      payload: { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 4242, type: 'private' }, text } },
    });

  it('links Telegram from the tablet: a QR link, the bot’s /start, then «linked», then «Отвязать»', async () => {
    const auth = { authorization: `Bearer ${await pinSession()}` };

    const before = await app.inject({ method: 'GET', url: '/auth/telegram/notify-link', headers: auth });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ linked: false, botLinkAvailable: true });

    const issued = await app.inject({ method: 'POST', url: '/auth/telegram/notify-link', headers: auth });
    expect(issued.statusCode).toBe(200);
    const url = (issued.json() as { url: string }).url;
    expect(url).toMatch(/^https:\/\/t\.me\/takaway_tgbot\?start=link_/);
    const start = `/start ${new URL(url).searchParams.get('start')}`;

    const update = await webhook(WEBHOOK_SECRET, start);
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ ok: true });
    expect(accounts.get('barista')?.telegramNotifyChatId).toBe(4242n);
    expect(sendMessage).toHaveBeenCalledWith(4242n, expect.stringContaining('Готово!'));

    const after = await app.inject({ method: 'GET', url: '/auth/telegram/notify-link', headers: auth });
    expect(after.json()).toEqual({ linked: true, botLinkAvailable: true });

    const unlinked = await app.inject({ method: 'DELETE', url: '/auth/telegram/notify-link', headers: auth });
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json()).toEqual({ linked: false, botLinkAvailable: true });
    expect(accounts.get('barista')?.telegramNotifyChatId).toBeNull();
  });

  it('ends a PIN session whose PIN was reset, at once', async () => {
    const token = await pinSession();
    const barista = accounts.get('barista');
    if (barista) Object.assign(barista, { kdsPinHash: null, kdsPinBrandId: null });
    const res = await app.inject({
      method: 'GET',
      url: '/auth/telegram/notify-link',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('keeps customers off the «Telegram» page', async () => {
    const token = await jwt.signAsync({ sub: 'customer', jti: 'c' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/telegram/notify-link',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('takes the webhook without a session, but only with the secret', async () => {
    expect((await webhook(undefined, '/start')).statusCode).toBe(401);
    expect((await webhook('wrong-secret-0123456789', '/start')).statusCode).toBe(401);
    expect(sendMessage).not.toHaveBeenCalled();

    const ok = await webhook(WEBHOOK_SECRET, '/start');
    expect(ok.statusCode).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
