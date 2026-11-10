import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { TakeawayPromo, WelcomeBonus } from '@prisma/client';

import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { WelcomeBonusService, welcomeIdentityHash } from './welcome-bonus.service';

const NOW = new Date('2026-11-10T12:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60_000);
const sha = (key: string) => createHash('sha256').update(key).digest('hex');

const promoRow = (over: Partial<TakeawayPromo> = {}): TakeawayPromo => ({
  id: 'tp-welcome',
  name: 'Приветственный бонус',
  code: 'WELCOME10',
  percent: 10,
  startsAt: day(-10),
  endsAt: day(60),
  currency: 'MDL',
  budgetCents: 500_000,
  spentCents: 1_000,
  status: 'ACTIVE',
  exhaustedAt: null,
  isWelcome: true,
  createdById: null,
  createdAt: day(-10),
  updatedAt: day(-10),
  ...over,
});

const bonusRow = (over: Partial<WelcomeBonus> = {}): WelcomeBonus => ({
  id: 'wb-1',
  promoId: 'tp-welcome',
  userId: 'user-1',
  identityHash: 'hash',
  expiresAt: day(7),
  orderId: null,
  notifiedAt: null,
  createdAt: NOW,
  ...over,
});

function harness() {
  const prisma = {
    takeawayPromo: { findMany: jest.fn().mockResolvedValue([promoRow()]) },
    welcomeBonus: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customerNotification: { create: jest.fn().mockResolvedValue({ id: 'n-1' }) },
  };
  const notifications = { sendCampaignTo: jest.fn().mockResolvedValue({ outcome: 'sent', via: ['APNS'] }) };
  const service = new WelcomeBonusService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, notifications };
}

describe('welcomeIdentityHash — once per person (docs/takeaway-promos.md §2.9)', () => {
  it('hashes the identity the account was created with', () => {
    expect(welcomeIdentityHash({ kind: 'telegram', telegramUserId: 777n })).toBe(sha('tg:777'));
    expect(welcomeIdentityHash({ kind: 'email', address: ' Ivan@Mail.RU ' })).toBe(sha('email:ivan@mail.ru'));
    expect(welcomeIdentityHash({ kind: 'oauth', provider: 'GOOGLE', subject: '1234' })).toBe(sha('oauth:google:1234'));
  });
});

describe('WelcomeBonusService.onCustomerCreated', () => {
  let error: jest.SpyInstance;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('gives a new customer the live welcome promo for 7 days', async () => {
    const { service, prisma } = harness();

    await expect(service.onCustomerCreated('user-1', { kind: 'telegram', telegramUserId: 777 }, NOW)).resolves.toBe(
      true,
    );

    expect(prisma.takeawayPromo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isWelcome: true, status: 'ACTIVE', startsAt: { lte: NOW }, endsAt: { gte: NOW } },
      }),
    );
    expect(prisma.welcomeBonus.create).toHaveBeenCalledWith({
      data: { promoId: 'tp-welcome', userId: 'user-1', identityHash: sha('tg:777'), expiresAt: day(7) },
    });
  });

  it('gives nothing without a live welcome promo, or once its budget is gone', async () => {
    const none = harness();
    none.prisma.takeawayPromo.findMany.mockResolvedValue([]);
    await expect(none.service.onCustomerCreated('user-1', { kind: 'email', address: 'a@b.c' }, NOW)).resolves.toBe(
      false,
    );
    expect(none.prisma.welcomeBonus.create).not.toHaveBeenCalled();

    const spent = harness();
    spent.prisma.takeawayPromo.findMany.mockResolvedValue([promoRow({ spentCents: 500_000 })]);
    await expect(spent.service.onCustomerCreated('user-1', { kind: 'email', address: 'a@b.c' }, NOW)).resolves.toBe(
      false,
    );
    expect(spent.prisma.welcomeBonus.create).not.toHaveBeenCalled();
  });

  it('gives a person who had one before nothing, quietly', async () => {
    const { service, prisma } = harness();
    prisma.welcomeBonus.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(service.onCustomerCreated('user-2', { kind: 'telegram', telegramUserId: 777 }, NOW)).resolves.toBe(
      false,
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('never throws, whatever goes wrong', async () => {
    const { service, prisma } = harness();
    prisma.takeawayPromo.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.onCustomerCreated('user-1', { kind: 'telegram', telegramUserId: 1 }, NOW)).resolves.toBe(
      false,
    );
    expect(error).toHaveBeenCalled();
  });
});

describe('WelcomeBonusService.listForUser — GET /me/bonuses', () => {
  it('shows the bonus while it can be used', async () => {
    const { service, prisma } = harness();
    prisma.welcomeBonus.findUnique.mockResolvedValue({ ...bonusRow(), promo: promoRow() });

    await expect(service.listForUser('user-1', NOW)).resolves.toEqual([
      {
        id: 'wb-1',
        kind: 'WELCOME',
        promoId: 'tp-welcome',
        code: 'WELCOME10',
        name: 'Приветственный бонус',
        percent: 10,
        currency: 'MDL',
        expiresAt: day(7).toISOString(),
      },
    ]);
  });

  it.each([
    ['used', bonusRow({ orderId: 'order-1' }), promoRow()],
    ['expired', bonusRow({ expiresAt: day(-1) }), promoRow()],
    ['of a switched-off promo', bonusRow(), promoRow({ status: 'DISABLED' })],
    ['of a promo past its end', bonusRow(), promoRow({ endsAt: day(-1) })],
    ['of a promo out of budget', bonusRow(), promoRow({ spentCents: 500_000 })],
  ])('hides a bonus %s', async (_label, bonus, promo) => {
    const { service, prisma } = harness();
    prisma.welcomeBonus.findUnique.mockResolvedValue({ ...bonus, promo });
    await expect(service.listForUser('user-1', NOW)).resolves.toEqual([]);
  });

  it('is empty without a bonus', async () => {
    const { service } = harness();
    await expect(service.listForUser('user-1', NOW)).resolves.toEqual([]);
  });
});

describe('WelcomeBonusService.notifyPending — the cron a minute after sign-up', () => {
  const due = (over: { locale?: 'RU' | 'EN' } = {}) => ({
    id: 'wb-1',
    userId: 'user-1',
    promo: { percent: 10 },
    user: { locale: over.locale ?? 'RU' },
  });

  it('claims each bonus, writes the inbox item and pushes it as a platform announcement', async () => {
    const { service, prisma, notifications } = harness();
    prisma.welcomeBonus.findMany.mockResolvedValue([due()]);

    await expect(service.notifyPending(NOW)).resolves.toBe(1);

    expect(prisma.welcomeBonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          notifiedAt: null,
          orderId: null,
          createdAt: { lte: new Date(NOW.getTime() - 60_000), gte: day(-1) },
          expiresAt: { gt: NOW },
          user: { blockedAt: null },
        },
      }),
    );
    expect(prisma.welcomeBonus.updateMany).toHaveBeenCalledWith({
      where: { id: 'wb-1', notifiedAt: null },
      data: { notifiedAt: NOW },
    });
    expect(prisma.customerNotification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        kind: 'PLATFORM_ANNOUNCEMENT',
        title: 'Приветственный бонус',
        body: 'Добрый день! Добро пожаловать в экосистему takeAway. Вот ваш бонус: скидка 10% на заказ в любом заведении.',
      },
      select: { id: true },
    });
    expect(notifications.sendCampaignTo).toHaveBeenCalledWith(
      'user-1',
      'PUSH',
      'takeAway: Приветственный бонус',
      expect.stringContaining('скидка 10%'),
      { push: { kind: 'announcement', notificationId: 'n-1' } },
    );
  });

  it('writes in English for an English-speaking customer', async () => {
    const { service, prisma } = harness();
    prisma.welcomeBonus.findMany.mockResolvedValue([due({ locale: 'EN' })]);

    await service.notifyPending(NOW);

    expect(prisma.customerNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Your welcome bonus' }) }),
    );
  });

  it('skips a bonus another instance claimed first', async () => {
    const { service, prisma, notifications } = harness();
    prisma.welcomeBonus.findMany.mockResolvedValue([due()]);
    prisma.welcomeBonus.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.notifyPending(NOW)).resolves.toBe(0);
    expect(prisma.customerNotification.create).not.toHaveBeenCalled();
    expect(notifications.sendCampaignTo).not.toHaveBeenCalled();
  });

  it('goes on to the next customer when one push fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, prisma, notifications } = harness();
    prisma.welcomeBonus.findMany.mockResolvedValue([due(), { ...due(), id: 'wb-2', userId: 'user-2' }]);
    notifications.sendCampaignTo.mockRejectedValueOnce(new Error('APNs down'));

    await expect(service.notifyPending(NOW)).resolves.toBe(1);
    expect(notifications.sendCampaignTo).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
  });
});
