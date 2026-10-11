import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { FeedbackKind, FeedbackSource, FeedbackStatus } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { FeedbackNotifier } from './feedback-notifier.service';
import {
  FEEDBACK_PER_HOUR,
  FEEDBACK_TOO_MANY,
  FeedbackService,
  SITE_SUPPORT_PER_CONTACT_PER_HOUR,
  SiteSupportError,
} from './feedback.service';

const NOW = new Date('2026-10-07T12:00:00Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fb-1',
    kind: FeedbackKind.SUGGESTION,
    message: 'Add oat milk',
    contact: null,
    name: null,
    source: FeedbackSource.IOS,
    appVersion: '1.2.0 (3)',
    status: FeedbackStatus.NEW,
    createdAt: new Date('2026-10-07T10:00:00Z'),
    readAt: null,
    user: {
      id: 'ana',
      name: 'Ana',
      email: 'ana@example.com',
      phone: null,
      telegramUserId: 777000111222n,
      blockedAt: null,
    },
    brand: null,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    feedback: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'fb-1', createdAt: new Date('2026-10-07T12:00:00Z') }),
      findMany: jest.fn().mockResolvedValue([row()]),
      findUnique: jest.fn().mockResolvedValue({ readAt: null }),
      update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data)),
    },
  };
  const notifier = { feedbackReceived: jest.fn().mockResolvedValue(undefined) };
  const svc = new FeedbackService(prisma as unknown as PrismaService, notifier as unknown as FeedbackNotifier);
  return { svc, prisma, notifier };
}

const dto = {
  kind: FeedbackKind.SUGGESTION,
  message: 'Add oat milk',
  source: FeedbackSource.IOS,
};

describe('FeedbackService.create', () => {
  it('saves the message for the caller and tells the platform team', async () => {
    const { svc, prisma, notifier } = setup();

    const receipt = await svc.create('ana', { ...dto, contact: ' @ana ', appVersion: '1.2.0 (3)' }, NOW);

    expect(receipt).toEqual({ id: 'fb-1', createdAt: '2026-10-07T12:00:00.000Z' });
    expect(prisma.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'ana',
          kind: 'SUGGESTION',
          message: 'Add oat milk',
          contact: '@ana',
          source: 'IOS',
          appVersion: '1.2.0 (3)',
        },
      }),
    );
    expect(notifier.feedbackReceived).toHaveBeenCalledWith('fb-1');
  });

  it('stores no contact or version when there is none', async () => {
    const { svc, prisma } = setup();
    await svc.create('ana', dto, NOW);
    expect(prisma.feedback.create.mock.calls[0][0].data).toMatchObject({ contact: null, appVersion: null });
  });

  it('counts the caller’s messages of the last hour', async () => {
    const { svc, prisma } = setup();
    await svc.create('ana', dto, NOW);
    expect(prisma.feedback.count).toHaveBeenCalledWith({
      where: { userId: 'ana', createdAt: { gte: new Date('2026-10-07T11:00:00Z') } },
    });
  });

  it('refuses with 429 FEEDBACK_TOO_MANY past the hourly cap and saves nothing', async () => {
    const { svc, prisma, notifier } = setup();
    prisma.feedback.count.mockResolvedValue(FEEDBACK_PER_HOUR);

    const err = await svc.create('ana', dto, NOW).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((err as HttpException).getResponse()).toMatchObject({ code: FEEDBACK_TOO_MANY });
    expect(prisma.feedback.create).not.toHaveBeenCalled();
    expect(notifier.feedbackReceived).not.toHaveBeenCalled();
  });

  it('answers even when the announcement is still on its way', async () => {
    const { svc, notifier } = setup();
    notifier.feedbackReceived.mockReturnValue(new Promise(() => undefined));
    await expect(svc.create('ana', dto, NOW)).resolves.toEqual(expect.objectContaining({ id: 'fb-1' }));
  });
});

describe('FeedbackService.createFromBusiness', () => {
  it('files the message under the brand, from the business admin, and tells the platform team', async () => {
    const { svc, prisma, notifier } = setup();

    await svc.createFromBusiness(
      'owner',
      'b1',
      { kind: FeedbackKind.QUESTION, message: '  Как подключить карты?  ' },
      NOW,
    );

    expect(prisma.feedback.create).toHaveBeenCalledWith({
      data: {
        userId: 'owner',
        brandId: 'b1',
        kind: 'QUESTION',
        message: 'Как подключить карты?',
        source: 'BUSINESS',
      },
      select: { id: true, createdAt: true },
    });
    expect(notifier.feedbackReceived).toHaveBeenCalledWith('fb-1');
  });

  it('shares the hourly cap with everything else the account sends', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.count.mockResolvedValue(FEEDBACK_PER_HOUR);

    await expect(
      svc.createFromBusiness('owner', 'b1', { kind: FeedbackKind.PROBLEM, message: 'Не грузится меню' }, NOW),
    ).rejects.toMatchObject({ response: { code: FEEDBACK_TOO_MANY } });
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });
});

describe('FeedbackService.list', () => {
  it('shows everything not archived, newest first, by default', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.count.mockResolvedValueOnce(1).mockResolvedValueOnce(4);

    const page = await svc.list({});

    expect(prisma.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { not: 'ARCHIVED' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 25,
      }),
    );
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 25, newCount: 4 });
  });

  it('filters by status and kind and pages', async () => {
    const { svc, prisma } = setup();
    await svc.list({ status: FeedbackStatus.ARCHIVED, kind: FeedbackKind.PROBLEM, page: 3, pageSize: 10 });
    expect(prisma.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ARCHIVED', kind: 'PROBLEM' }, skip: 20, take: 10 }),
    );
  });

  it('hands the author over with the Telegram id as a string', async () => {
    const { svc } = setup();
    const page = await svc.list({});
    expect(page.items[0]).toEqual({
      id: 'fb-1',
      kind: 'SUGGESTION',
      message: 'Add oat milk',
      contact: null,
      name: null,
      source: 'IOS',
      appVersion: '1.2.0 (3)',
      status: 'NEW',
      createdAt: '2026-10-07T10:00:00.000Z',
      readAt: null,
      author: {
        id: 'ana',
        name: 'Ana',
        email: 'ana@example.com',
        phone: null,
        telegramUserId: '777000111222',
        deleted: false,
      },
      brand: null,
    });
  });

  it('carries the brand of a business message and filters by source', async () => {
    const { svc, prisma } = setup();
    const brand = { id: 'b1', name: 'Кофейня Ромашка', contactPhone: '+37369123456' };
    prisma.feedback.findMany.mockResolvedValue([row({ source: FeedbackSource.BUSINESS, brand })]);

    const page = await svc.list({ source: FeedbackSource.BUSINESS });

    expect(prisma.feedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { not: 'ARCHIVED' }, source: 'BUSINESS' } }),
    );
    expect(page.items[0]?.brand).toEqual(brand);
  });

  it('marks the author of a deleted account and copes with no author at all', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.findMany.mockResolvedValue([
      row({
        user: { id: 'ana', name: null, email: null, phone: null, telegramUserId: null, blockedAt: NOW },
      }),
      row({ id: 'fb-2', user: null }),
    ]);
    const page = await svc.list({});
    expect(page.items[0]?.author).toMatchObject({ deleted: true, name: null });
    expect(page.items[1]?.author).toBeNull();
  });

  it('hands over the name and contact a visitor left on the site', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.findMany.mockResolvedValue([
      row({ user: null, name: 'Ион', contact: 'ion@mail.md', source: FeedbackSource.WEB }),
    ]);
    const page = await svc.list({});
    expect(page.items[0]).toMatchObject({ author: null, name: 'Ион', contact: 'ion@mail.md', source: 'WEB' });
  });
});

describe('FeedbackService.createFromSite', () => {
  const question = { kind: FeedbackKind.QUESTION, message: '  Где мой заказ 1234?  ' };

  async function refusal(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    const http = err as HttpException;
    return { status: http.getStatus(), code: (http.getResponse() as { code?: unknown }).code };
  }

  it('files a visitor’s message with the contact in one canonical form and pings the team', async () => {
    const { svc, prisma, notifier } = setup();

    await svc.createFromSite(null, { ...question, name: ' Ион ', contact: ' Ion@Mail.MD ' }, NOW);

    expect(prisma.feedback.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        kind: 'QUESTION',
        message: 'Где мой заказ 1234?',
        contact: 'ion@mail.md',
        name: 'Ион',
        source: 'WEB',
      },
      select: { id: true },
    });
    expect(notifier.feedbackReceived).toHaveBeenCalledWith('fb-1');
  });

  it('stores a phone as E.164', async () => {
    const { svc, prisma } = setup();
    await svc.createFromSite(null, { ...question, contact: '069 123 456' }, NOW);
    expect(prisma.feedback.create.mock.calls[0][0].data).toMatchObject({ contact: '+37369123456', name: null });
  });

  it('wants a way to answer a visitor', async () => {
    const { svc, prisma } = setup();
    expect(await refusal(svc.createFromSite(null, question, NOW))).toEqual({
      status: HttpStatus.BAD_REQUEST,
      code: SiteSupportError.CONTACT_REQUIRED,
    });
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it('refuses a contact that is neither an email nor a phone, even from a customer', async () => {
    const { svc, prisma } = setup();
    for (const userId of [null, 'ana']) {
      expect(await refusal(svc.createFromSite(userId, { ...question, contact: '@ivan_tg' }, NOW))).toEqual({
        status: HttpStatus.BAD_REQUEST,
        code: SiteSupportError.CONTACT_INVALID,
      });
    }
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it('links a signed-in customer’s message to the account, a contact being optional', async () => {
    const { svc, prisma } = setup();

    await svc.createFromSite('ana', { ...question, name: 'Not me' }, NOW);

    expect(prisma.feedback.create.mock.calls[0][0].data).toMatchObject({
      userId: 'ana',
      contact: null,
      name: null,
      source: 'WEB',
    });
    expect(prisma.feedback.count).toHaveBeenCalledWith({
      where: { userId: 'ana', createdAt: { gte: new Date('2026-10-07T11:00:00Z') } },
    });
  });

  it('caps one contact at a few messages an hour', async () => {
    const { svc, prisma, notifier } = setup();
    prisma.feedback.count.mockResolvedValue(SITE_SUPPORT_PER_CONTACT_PER_HOUR);

    expect(await refusal(svc.createFromSite(null, { ...question, contact: '+373 69 123 456' }, NOW))).toEqual({
      status: HttpStatus.TOO_MANY_REQUESTS,
      code: FEEDBACK_TOO_MANY,
    });
    expect(prisma.feedback.count).toHaveBeenCalledWith({
      where: { contact: '+37369123456', createdAt: { gte: new Date('2026-10-07T11:00:00Z') } },
    });
    expect(prisma.feedback.create).not.toHaveBeenCalled();
    expect(notifier.feedbackReceived).not.toHaveBeenCalled();
  });

  it('keeps the account cap for a signed-in customer', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.count.mockResolvedValue(FEEDBACK_PER_HOUR);
    expect((await refusal(svc.createFromSite('ana', question, NOW))).status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(prisma.feedback.create).not.toHaveBeenCalled();
  });

  it('drops what a bot sends through the honeypot field, without telling it', async () => {
    const { svc, prisma, notifier } = setup();

    await expect(
      svc.createFromSite(null, { ...question, contact: 'bot@spam.io', website: 'https://spam.io' }, NOW),
    ).resolves.toBeUndefined();

    expect(prisma.feedback.count).not.toHaveBeenCalled();
    expect(prisma.feedback.create).not.toHaveBeenCalled();
    expect(notifier.feedbackReceived).not.toHaveBeenCalled();
  });
});

describe('FeedbackService.setStatus', () => {
  it('stamps the first read', async () => {
    const { svc, prisma } = setup();
    const result = await svc.setStatus('fb-1', FeedbackStatus.READ, NOW);
    expect(prisma.feedback.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fb-1' }, data: { status: 'READ', readAt: NOW } }),
    );
    expect(result.readAt).toBe(NOW.toISOString());
  });

  it('keeps the first read time when archiving', async () => {
    const { svc, prisma } = setup();
    const firstRead = new Date('2026-10-07T11:00:00Z');
    prisma.feedback.findUnique.mockResolvedValue({ readAt: firstRead });
    await svc.setStatus('fb-1', FeedbackStatus.ARCHIVED, NOW);
    expect(prisma.feedback.update.mock.calls[0][0].data).toEqual({ status: 'ARCHIVED', readAt: firstRead });
  });

  it('clears the read time when marked unread again', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.findUnique.mockResolvedValue({ readAt: new Date('2026-10-07T11:00:00Z') });
    await svc.setStatus('fb-1', FeedbackStatus.NEW, NOW);
    expect(prisma.feedback.update.mock.calls[0][0].data).toEqual({ status: 'NEW', readAt: null });
  });

  it('answers 404 for feedback that does not exist', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.findUnique.mockResolvedValue(null);
    await expect(svc.setStatus('nope', FeedbackStatus.READ, NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.feedback.update).not.toHaveBeenCalled();
  });
});

describe('FeedbackService.newCount', () => {
  it('counts the unread', async () => {
    const { svc, prisma } = setup();
    prisma.feedback.count.mockResolvedValue(7);
    await expect(svc.newCount()).resolves.toEqual({ count: 7 });
    expect(prisma.feedback.count).toHaveBeenCalledWith({ where: { status: 'NEW' } });
  });
});
