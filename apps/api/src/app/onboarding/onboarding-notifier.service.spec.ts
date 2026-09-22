import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { BrandModerationStatus, Currency, Locale } from '@prisma/client';

import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { MailService } from '../mail/mail.service';
import type { OpsChatService } from '../notifications/ops-chat.service';
import type { PrismaService } from '../prisma/prisma.service';
import { OnboardingNotifier } from './onboarding-notifier.service';

interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function brand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    name: 'Ромашка',
    currency: Currency.MDL,
    locale: Locale.RU,
    moderationNote: null,
    owner: { name: 'Ион', email: 'owner@romashka.md', phone: '+37369123456' },
    ...overrides,
  };
}

describe('OnboardingNotifier', () => {
  let prisma: { brand: { findUnique: jest.Mock }; user: { findMany: jest.Mock } };
  let mail: { send: jest.Mock };
  let opsChat: { send: jest.Mock };
  let notifier: OnboardingNotifier;
  let logged: jest.SpyInstance;

  const sent = (): SentMail[] =>
    mail.send.mock.calls.map(([to, subject, text, html]) => ({ to, subject, text, html }) as SentMail);
  const to = (address: string): SentMail | undefined => sent().find((m) => m.to === address);

  beforeEach(() => {
    prisma = {
      brand: { findUnique: jest.fn().mockResolvedValue(brand()) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { email: 'root@takeaway.md', locale: Locale.RU },
          { email: 'ops@takeaway.md', locale: Locale.EN },
        ]),
      },
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    opsChat = { send: jest.fn().mockResolvedValue(true) };
    const config = {
      get: jest.fn((key: string) => (key === 'ADMIN_APP_URL' ? 'https://admin.takeaway.md/' : undefined)),
    };
    const flags = { support: { email: 'help@takeaway.md', telegram: 'https://t.me/takeaway_help' } };
    notifier = new OnboardingNotifier(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      opsChat as unknown as OpsChatService,
      flags as unknown as FeatureFlagsService,
      config as unknown as ConfigService,
    );
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => logged.mockRestore());

  describe('a new sign-up', () => {
    it('thanks the owner in the brand language and points them at the admin', async () => {
      await notifier.brandSubmitted('b1');

      const owner = to('owner@romashka.md');
      expect(owner?.subject).toBe('Заявка «Ромашка» получена');
      expect(owner?.text).toContain('до 1 рабочего дня');
      expect(owner?.text).toContain('https://admin.takeaway.md/dashboard');
    });

    it('wakes every platform admin in their own language, and the ops chat', async () => {
      await notifier.brandSubmitted('b1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: 'SUPER_ADMIN', email: { not: null }, blockedAt: null } }),
      );
      expect(to('root@takeaway.md')?.subject).toBe('Новая заявка на модерацию: Ромашка');
      expect(to('ops@takeaway.md')?.subject).toBe('New brand to review: Ромашка');
      expect(to('ops@takeaway.md')?.text).toContain('owner@romashka.md');
      expect(to('ops@takeaway.md')?.text).toContain('https://admin.takeaway.md/brands');
      expect(opsChat.send).toHaveBeenCalledWith(expect.stringContaining('New brand to review: Ромашка'));
    });

    it('still alerts the platform about a brand with no owner to thank', async () => {
      prisma.brand.findUnique.mockResolvedValue(brand({ owner: null }));

      await notifier.brandSubmitted('b1');

      expect(
        sent()
          .map((m) => m.to)
          .sort(),
      ).toEqual(['ops@takeaway.md', 'root@takeaway.md']);
    });
  });

  it('tells the platform, not the owner, about a resubmission', async () => {
    await notifier.brandResubmitted('b1');

    expect(to('owner@romashka.md')).toBeUndefined();
    expect(to('root@takeaway.md')?.subject).toBe('Повторная заявка на модерацию: Ромашка');
    expect(opsChat.send).toHaveBeenCalledWith(expect.stringContaining('Brand resubmitted for review'));
  });

  describe('a decision', () => {
    it('congratulates the owner on an approval', async () => {
      await notifier.brandModerated('b1', BrandModerationStatus.APPROVED);

      expect(sent()).toHaveLength(1);
      expect(to('owner@romashka.md')?.subject).toBe('Бренд «Ромашка» одобрен');
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('sends the reason and the support contact with a rejection', async () => {
      prisma.brand.findUnique.mockResolvedValue(brand({ locale: Locale.EN, moderationNote: 'Add product photos' }));

      await notifier.brandModerated('b1', BrandModerationStatus.REJECTED);

      const owner = to('owner@romashka.md');
      expect(owner?.subject).toBe('Ромашка: changes needed');
      expect(owner?.text).toContain("Reviewer's note: Add product photos");
      expect(owner?.text).toContain('help@takeaway.md, https://t.me/takeaway_help');
    });

    it('says nothing when a brand is only moved back to review', async () => {
      await notifier.brandModerated('b1', BrandModerationStatus.PENDING);

      expect(prisma.brand.findUnique).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });
  });

  describe('when delivery fails', () => {
    it('keeps going past a failed mail and resolves anyway', async () => {
      mail.send.mockImplementation((address: string) =>
        address === 'owner@romashka.md' ? Promise.reject(new Error('SMTP timeout')) : Promise.resolve(),
      );

      await expect(notifier.brandSubmitted('b1')).resolves.toBeUndefined();

      expect(to('root@takeaway.md')).toBeDefined();
      expect(opsChat.send).toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('SMTP timeout'));
    });

    it('resolves when even the brand cannot be read', async () => {
      prisma.brand.findUnique.mockRejectedValue(new Error('connection reset'));

      await expect(notifier.brandModerated('b1', BrandModerationStatus.APPROVED)).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
    });
  });

  it('escapes the brand name in the HTML part', async () => {
    prisma.brand.findUnique.mockResolvedValue(brand({ name: '<b>Кофе & Ко</b>' }));

    await notifier.brandModerated('b1', BrandModerationStatus.APPROVED);

    expect(to('owner@romashka.md')?.html).toContain('&lt;b&gt;Кофе &amp; Ко&lt;/b&gt;');
    expect(to('owner@romashka.md')?.html).not.toContain('<b>');
  });
});
