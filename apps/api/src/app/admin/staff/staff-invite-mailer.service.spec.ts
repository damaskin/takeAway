import type { ConfigService } from '@nestjs/config';

import { PasswordService } from '../../auth/services/password.service';
import type { MailService, OutgoingMail } from '../../mail/mail.service';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  STAFF_INVITE_LINK_TTL_HOURS,
  StaffInviteMailer,
  type StaffInviteRecipient,
} from './staff-invite-mailer.service';

function build(opts: { smtp: boolean; env?: Record<string, string>; delivered?: boolean }) {
  const env = opts.env ?? { NODE_ENV: 'production', ADMIN_APP_URL: 'https://admin.takeaway.md' };
  const prisma = {
    store: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ brand: { name: 'NoName Coffee' } }, { brand: { name: 'NoName Coffee' } }]),
    },
    passwordResetToken: { create: jest.fn().mockResolvedValue({}) },
  };
  const mail = {
    isConfigured: jest.fn(() => opts.smtp),
    sendStaffInvite: jest.fn(async (_to: string, _mail: OutgoingMail) => opts.delivered ?? true),
    sendStaffPasswordReset: jest.fn(async (_to: string, _mail: OutgoingMail) => opts.delivered ?? true),
  };
  const passwords = new PasswordService();
  const mailer = new StaffInviteMailer(
    prisma as unknown as PrismaService,
    passwords,
    mail as unknown as MailService,
    { get: (key: string) => env[key] } as unknown as ConfigService,
  );
  return { mailer, prisma, mail, passwords };
}

const barista = (overrides: Partial<StaffInviteRecipient> = {}): StaffInviteRecipient => ({
  userId: 'u-new',
  email: 'barista@cafe.md',
  name: 'Анна',
  role: 'STAFF',
  storeIds: ['store-1', 'store-2'],
  newAccount: true,
  ...overrides,
});

describe('StaffInviteMailer', () => {
  it('mails a new account a one-time set-password link that works for 72 hours, and says SENT', async () => {
    const { mailer, prisma, mail, passwords } = build({ smtp: true });
    const before = Date.now();
    await expect(mailer.send(barista())).resolves.toBe('SENT');

    const { data } = prisma.passwordResetToken.create.mock.calls[0]?.[0] as {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    };
    expect(data.userId).toBe('u-new');
    const ttlHours = (data.expiresAt.getTime() - before) / 3_600_000;
    expect(Math.round(ttlHours)).toBe(STAFF_INVITE_LINK_TTL_HOURS);

    const [to, message] = mail.sendStaffInvite.mock.calls[0] as [string, OutgoingMail];
    expect(to).toBe('barista@cafe.md');
    const link = /https:\/\/admin\.takeaway\.md\/reset-password\?token=([A-Za-z0-9_-]+)&invite=1/.exec(message.text);
    expect(link).not.toBeNull();
    // The link carries the raw token; only its hash is stored.
    expect(passwords.hashResetToken(link?.[1] ?? '')).toBe(data.tokenHash);
    expect(message.text).toContain('«NoName Coffee»');
    expect(message.text).toContain('https://admin.takeaway.md/login');
  });

  it('tells an existing account where to sign in, without a token', async () => {
    const { mailer, prisma, mail } = build({ smtp: true });
    await expect(mailer.send(barista({ newAccount: false }))).resolves.toBe('SENT');
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    const [, message] = mail.sendStaffInvite.mock.calls[0] as [string, OutgoingMail];
    expect(message.text).toContain('https://admin.takeaway.md/forgot-password');
    expect(message.text).not.toContain('reset-password?token');
  });

  it('sends nothing and makes no token without SMTP — NOT_CONFIGURED', async () => {
    const { mailer, prisma, mail } = build({ smtp: false });
    await expect(mailer.send(barista())).resolves.toBe('NOT_CONFIGURED');
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail.sendStaffInvite).not.toHaveBeenCalled();
  });

  it('is NOT_CONFIGURED in production without ADMIN_APP_URL — no localhost links', async () => {
    const { mailer, mail } = build({ smtp: true, env: { NODE_ENV: 'production' } });
    await expect(mailer.send(barista())).resolves.toBe('NOT_CONFIGURED');
    expect(mail.sendStaffInvite).not.toHaveBeenCalled();
  });

  it('says FAILED when the mail server refuses', async () => {
    const { mailer } = build({ smtp: true, delivered: false });
    await expect(mailer.send(barista())).resolves.toBe('FAILED');
  });

  describe('after the owner reset a password', () => {
    const reset = { userId: 'u-1', email: 'barista@cafe.md', name: 'Анна', storeIds: ['store-1'] };

    it('mails a one-time link to set a new password, never the temporary one', async () => {
      const { mailer, prisma, mail, passwords } = build({ smtp: true });
      await expect(mailer.sendPasswordReset(reset)).resolves.toBe('SENT');

      const { data } = prisma.passwordResetToken.create.mock.calls[0]?.[0] as {
        data: { userId: string; tokenHash: string };
      };
      expect(data.userId).toBe('u-1');
      const [to, message] = mail.sendStaffPasswordReset.mock.calls[0] as [string, OutgoingMail];
      expect(to).toBe('barista@cafe.md');
      expect(message.subject).toContain('NoName Coffee');
      const link = /https:\/\/admin\.takeaway\.md\/reset-password\?token=([A-Za-z0-9_-]+)(\s|$)/.exec(message.text);
      expect(link).not.toBeNull();
      expect(passwords.hashResetToken(link?.[1] ?? '')).toBe(data.tokenHash);
      expect(message.text).toContain('Старый пароль больше не действует');
      expect(message.text).toContain('https://admin.takeaway.md/login');
    });

    it('sends nothing and makes no token without SMTP', async () => {
      const { mailer, prisma, mail } = build({ smtp: false });
      await expect(mailer.sendPasswordReset(reset)).resolves.toBe('NOT_CONFIGURED');
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.sendStaffPasswordReset).not.toHaveBeenCalled();
    });

    it('says FAILED when the mail server refuses', async () => {
      const { mailer } = build({ smtp: true, delivered: false });
      await expect(mailer.sendPasswordReset(reset)).resolves.toBe('FAILED');
    });
  });
});
