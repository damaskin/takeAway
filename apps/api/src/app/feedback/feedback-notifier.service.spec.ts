import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { FeedbackKind, FeedbackSource, Locale } from '@prisma/client';

import type { MailService } from '../mail/mail.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OpsChatService } from '../notifications/ops-chat.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FeedbackNotifier } from './feedback-notifier.service';

function feedback(overrides: Record<string, unknown> = {}) {
  return {
    kind: FeedbackKind.SUGGESTION,
    source: FeedbackSource.IOS,
    appVersion: '1.2.0 (3)',
    message: 'Добавьте овсяное молоко',
    contact: '@ana_tg',
    user: { name: 'Ана', email: 'ana@example.com', phone: '+37377700000' },
    ...overrides,
  };
}

describe('FeedbackNotifier', () => {
  let prisma: { feedback: { findUnique: jest.Mock }; user: { findMany: jest.Mock } };
  let mail: { send: jest.Mock; isConfigured: jest.Mock };
  let opsChat: { enabled: boolean; send: jest.Mock };
  let notifications: { deliver: jest.Mock };
  let env: Record<string, string | undefined>;
  let notifier: FeedbackNotifier;
  let errors: jest.SpyInstance;
  let warnings: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      feedback: { findUnique: jest.fn().mockResolvedValue(feedback()) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'root', email: 'root@takeaway.md', locale: Locale.EN, telegramUserId: 111n },
          { id: 'ops', email: null, locale: Locale.RU, telegramUserId: null },
        ]),
      },
    };
    mail = { send: jest.fn().mockResolvedValue(undefined), isConfigured: jest.fn().mockReturnValue(false) };
    opsChat = { enabled: true, send: jest.fn().mockResolvedValue(true) };
    notifications = { deliver: jest.fn().mockResolvedValue({ outcome: 'sent', via: ['telegram'] }) };
    env = { ADMIN_APP_URL: 'https://admin.takeaway.md/' };
    notifier = new FeedbackNotifier(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      opsChat as unknown as OpsChatService,
      notifications as unknown as NotificationsService,
      { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService,
    );
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('posts the feedback to the ops chat in Russian by default, with who wrote it and a link', async () => {
    await notifier.feedbackReceived('fb-1');

    expect(opsChat.send).toHaveBeenCalledTimes(1);
    const text = opsChat.send.mock.calls[0][0] as string;
    expect(text).toContain('Обратная связь: предложение');
    expect(text).toContain('От: Ана, ana@example.com, +37377700000 · iOS 1.2.0 (3)');
    expect(text).toContain('Как связаться: @ana_tg');
    expect(text).toContain('Добавьте овсяное молоко');
    expect(text).toContain('https://admin.takeaway.md/feedback');
    // The chat got it, so nobody is messaged privately on top.
    expect(notifications.deliver).not.toHaveBeenCalled();
  });

  it('speaks English when PLATFORM_LOCALE says so and leaves out a missing contact', async () => {
    env['PLATFORM_LOCALE'] = 'en';
    prisma.feedback.findUnique.mockResolvedValue(
      feedback({ kind: FeedbackKind.PROBLEM, source: FeedbackSource.TMA, appVersion: null, contact: null }),
    );
    await notifier.feedbackReceived('fb-1');

    const text = opsChat.send.mock.calls[0][0] as string;
    expect(text).toContain('Customer feedback: problem');
    expect(text).toContain('· Telegram Mini App');
    expect(text).not.toContain('Contact:');
  });

  it('messages each platform admin with Telegram when there is no ops chat', async () => {
    opsChat.enabled = false;
    await notifier.feedbackReceived('fb-1');

    expect(opsChat.send).not.toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'SUPER_ADMIN', blockedAt: null } }),
    );
    expect(notifications.deliver).toHaveBeenCalledTimes(1);
    expect(notifications.deliver).toHaveBeenCalledWith(
      { userId: 'root', locale: Locale.EN, telegramUserId: 111n, pushTokens: [] },
      expect.objectContaining({
        kind: 'generic',
        title: 'Обратная связь: предложение',
        body: expect.stringContaining('Добавьте овсяное молоко'),
      }),
      'telegram',
    );
  });

  it('falls back to the admins’ own Telegram when the ops chat refuses the message', async () => {
    opsChat.send.mockResolvedValue(false);
    await notifier.feedbackReceived('fb-1');
    expect(notifications.deliver).toHaveBeenCalledTimes(1);
  });

  it('warns when nobody at all can be told in Telegram', async () => {
    opsChat.enabled = false;
    prisma.user.findMany.mockResolvedValue([{ id: 'root', email: null, locale: Locale.RU, telegramUserId: null }]);
    await notifier.feedbackReceived('fb-1');
    expect(notifications.deliver).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalled();
  });

  it('mails the platform admins only when SMTP is set up', async () => {
    await notifier.feedbackReceived('fb-1');
    expect(mail.send).not.toHaveBeenCalled();

    mail.isConfigured.mockReturnValue(true);
    await notifier.feedbackReceived('fb-1');
    expect(mail.send).toHaveBeenCalledTimes(1);
    const [to, subject, text, html] = mail.send.mock.calls[0] as string[];
    expect(to).toBe('root@takeaway.md');
    expect(subject).toBe('Обратная связь: предложение');
    expect(text).toContain('Открыть в панели: https://admin.takeaway.md/feedback');
    expect(html).toContain('Добавьте овсяное молоко');
  });

  it('escapes what the customer typed in the mail', async () => {
    mail.isConfigured.mockReturnValue(true);
    prisma.feedback.findUnique.mockResolvedValue(feedback({ message: '<script>alert(1)</script>' }));
    await notifier.feedbackReceived('fb-1');
    const html = mail.send.mock.calls[0][3] as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('names a feedback without an account with a dash', async () => {
    prisma.feedback.findUnique.mockResolvedValue(feedback({ user: null }));
    await notifier.feedbackReceived('fb-1');
    expect(opsChat.send.mock.calls[0][0]).toContain('От: — · iOS');
  });

  it('never throws — a broken database or Telegram only ends up in the log', async () => {
    prisma.feedback.findUnique.mockRejectedValue(new Error('db down'));
    await expect(notifier.feedbackReceived('fb-1')).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('db down'));

    prisma.feedback.findUnique.mockResolvedValue(feedback());
    opsChat.enabled = false;
    notifications.deliver.mockRejectedValue(new Error('telegram down'));
    await expect(notifier.feedbackReceived('fb-1')).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('telegram down'));
  });

  it('does nothing for feedback that is gone', async () => {
    prisma.feedback.findUnique.mockResolvedValue(null);
    await notifier.feedbackReceived('fb-1');
    expect(opsChat.send).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
