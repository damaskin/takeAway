import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { KdsPinService } from './services/kds-pin.service';
import type { KitchenDeviceService } from './services/kitchen-device.service';
import type { OAuthIdentityService } from './services/oauth-identity.service';
import { PasswordService } from './services/password.service';
import type { TelegramService } from './services/telegram.service';
import type { TokensService } from './services/tokens.service';

describe('AuthService.requestPasswordReset', () => {
  function build(env: Record<string, string>, opts: { smtp: boolean; user?: { role: Role } | null }) {
    const user = opts.user === undefined ? { id: 'u1', email: 'manager@cafe.md', role: Role.STORE_MANAGER } : opts.user;
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user ? { id: 'u1', email: 'manager@cafe.md', ...user } : null) },
      passwordResetToken: { create: jest.fn().mockResolvedValue({}) },
    };
    const mail = {
      isConfigured: jest.fn(() => opts.smtp),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    const auth = new AuthService(
      prisma as unknown as PrismaService,
      {} as UsersService,
      {} as TokensService,
      {} as TelegramService,
      {} as OAuthIdentityService,
      new PasswordService(),
      {} as KdsPinService,
      mail as unknown as MailService,
      config,
      {} as KitchenDeviceService,
    );
    return { auth, prisma, mail };
  }

  const prod = { NODE_ENV: 'production', ADMIN_APP_URL: 'https://admin.takeaway.md/' };

  it('mails a one-time link on the configured cabinet host', async () => {
    const { auth, prisma, mail } = build(prod, { smtp: true });
    await auth.requestPasswordReset('Manager@Cafe.md');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'manager@cafe.md' } });
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    const [to, url] = mail.sendPasswordReset.mock.calls[0] as [string, string];
    expect(to).toBe('manager@cafe.md');
    expect(url).toMatch(/^https:\/\/admin\.takeaway\.md\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
  });

  it('stays quiet about an unknown address or a customer', async () => {
    for (const user of [null, { role: Role.CUSTOMER }]) {
      const { auth, mail, prisma } = build(prod, { smtp: true, user });
      await expect(auth.requestPasswordReset('nobody@cafe.md')).resolves.toBeUndefined();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    }
  });

  it('answers 503 PASSWORD_RESET_UNAVAILABLE without SMTP — no promise of a letter that never leaves', async () => {
    const { auth, prisma, mail } = build(prod, { smtp: false });
    const error = (await auth.requestPasswordReset('manager@cafe.md').catch((e: unknown) => e)) as HttpException;

    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ code: 'PASSWORD_RESET_UNAVAILABLE' });
    // Decided before the account is looked up, so it says nothing about who exists.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('answers 503 in production without ADMIN_APP_URL instead of mailing a localhost link', async () => {
    const { auth, mail } = build({ NODE_ENV: 'production' }, { smtp: true });
    const error = (await auth.requestPasswordReset('manager@cafe.md').catch((e: unknown) => e)) as HttpException;
    expect(error.getStatus()).toBe(503);
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('links to the local admin outside production', async () => {
    const { auth, mail } = build({}, { smtp: true });
    await auth.requestPasswordReset('manager@cafe.md');
    expect(mail.sendPasswordReset.mock.calls[0]?.[1]).toMatch(/^http:\/\/localhost:4202\/reset-password\?token=/);
  });
});
