import { Logger } from '@nestjs/common';
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
  role: Role;
  name: string | null;
  locale: 'EN' | 'RU';
  blockedAt: Date | null;
  telegramUserId: bigint | null;
  telegramNotifyChatId: bigint | null;
}

/** Telegram sign-in and the older Telegram link, against users in memory. */
function harness(seed: Row[]) {
  const users = new Map(seed.map((u) => [u.id, { ...u }]));
  let next = 1;
  const byTelegram = (id: bigint) => [...users.values()].find((u) => u.telegramUserId === id) ?? null;
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { telegramUserId: bigint } }) => byTelegram(where.telegramUserId)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(users.get(where.id) as Row, data),
      ),
      upsert: jest.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { telegramUserId: bigint };
          update: Partial<Row>;
          create: Partial<Row>;
        }) => {
          const found = byTelegram(where.telegramUserId);
          if (found) return Object.assign(found, update);
          const created: Row = {
            id: `customer-${next++}`,
            role: Role.CUSTOMER,
            name: null,
            locale: 'EN',
            blockedAt: null,
            telegramUserId: null,
            telegramNotifyChatId: null,
            ...create,
          };
          users.set(created.id, created);
          return created;
        },
      ),
    },
    device: { create: jest.fn(async () => ({ id: 'device-1' })) },
  };
  const tokens = { issue: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })) };
  const telegram = { verifyInitData: jest.fn(() => ({ user: { id: 777, first_name: 'Ира' }, authDate: 0 })) };
  const oauth = { verifyTelegram: jest.fn(async () => ({ id: 777, firstName: 'Ира' })) };
  const auth = new AuthService(
    prisma as unknown as PrismaService,
    {} as UsersService,
    tokens as unknown as TokensService,
    telegram as unknown as TelegramService,
    oauth as unknown as OAuthIdentityService,
    {} as PasswordService,
    {} as KdsPinService,
    {} as MailService,
    { get: () => undefined } as unknown as ConfigService,
    {} as KitchenDeviceService,
  );
  return { auth, users, tokens };
}

const person = (id: string, role: Role, extra: Partial<Row> = {}): Row => ({
  id,
  role,
  name: id,
  locale: 'RU',
  blockedAt: null,
  telegramUserId: null,
  telegramNotifyChatId: null,
  ...extra,
});

describe('AuthService — Telegram sign-in never lands in a staff account', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('moves the Telegram id off a staff account that linked it for notifications, and opens a customer profile', async () => {
    const { auth, users, tokens } = harness([person('barista', Role.STAFF, { telegramUserId: 777n })]);

    const session = await auth.verifyTelegram('init-data');

    expect(session.user.id).not.toBe('barista');
    expect(session.user.role).toBe(Role.CUSTOMER);
    expect(users.get('barista')).toMatchObject({ telegramUserId: null, telegramNotifyChatId: 777n });
    expect(tokens.issue).toHaveBeenCalledWith(session.user.id, 'device-1');
  });

  it('keeps the notification chat a staff account already had', async () => {
    const { auth, users } = harness([
      person('owner', Role.BRAND_ADMIN, { telegramUserId: 777n, telegramNotifyChatId: 555n }),
    ]);
    await auth.loginWithTelegramIdToken('id-token');
    expect(users.get('owner')).toMatchObject({ telegramUserId: null, telegramNotifyChatId: 555n });
  });

  it('signs a customer in as before', async () => {
    const { auth, users } = harness([person('guest', Role.CUSTOMER, { telegramUserId: 777n })]);
    const session = await auth.verifyTelegram('init-data');
    expect(session.user.id).toBe('guest');
    expect(users.size).toBe(1);
  });
});

describe('AuthService — the older Telegram link sets the notification chat only', () => {
  it('writes the chat even when the Telegram account is the person’s own customer profile', async () => {
    const { auth, users } = harness([
      person('barista', Role.STAFF),
      person('barista-as-customer', Role.CUSTOMER, { telegramUserId: 777n }),
    ]);

    await auth.linkTelegramIdToken('barista', 'id-token');

    expect(users.get('barista')).toMatchObject({ telegramNotifyChatId: 777n, telegramUserId: null });
    expect(users.get('barista-as-customer')?.telegramUserId).toBe(777n);
  });
});
