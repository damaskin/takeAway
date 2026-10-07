import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { FeedbackKind, FeedbackSource, FeedbackStatus } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { FeedbackNotifier } from './feedback-notifier.service';
import { FEEDBACK_PER_HOUR, FEEDBACK_TOO_MANY, FeedbackService } from './feedback.service';

const NOW = new Date('2026-10-07T12:00:00Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fb-1',
    kind: FeedbackKind.SUGGESTION,
    message: 'Add oat milk',
    contact: null,
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
    });
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
