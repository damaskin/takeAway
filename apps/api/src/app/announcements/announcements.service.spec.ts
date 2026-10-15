import type { Announcement, CampaignDeliveryOutcome } from '@prisma/client';

import type { AudienceUser } from '../campaigns/campaigns.service';
import { STALE_SENDING_MS } from '../campaigns/campaigns.service';
import type { InboxService } from '../inbox/inbox.service';
import type { DeliveryResult, NotificationsService } from '../notifications/notifications.service';
import type { PushMessage } from '../notifications/providers/push-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { ANNOUNCEMENT_AUDIENCE, AnnouncementsService, isRetryable } from './announcements.service';

type DeviceRow = AudienceUser['devices'][number];

function user(
  over: Omit<Partial<AudienceUser>, 'devices'> & {
    devices?: Array<Pick<DeviceRow, 'pushToken' | 'type'> & Partial<DeviceRow>>;
  } = {},
): AudienceUser {
  return {
    id: 'u1',
    locale: 'RU',
    telegramUserId: null,
    email: null,
    notifyPromotions: true,
    ...over,
    devices: (over.devices ?? []).map((d) => ({ apnsToken: null, apnsEnvironment: null, ...d })),
  } as AudienceUser;
}

const base: Announcement = {
  id: 'a1',
  title: 'Новый партнёр',
  body: 'Solo теперь в takeAway',
  linkStoreId: 's1',
  linkBrandId: null,
  status: 'DRAFT',
  targetCount: 0,
  sentCount: 0,
  failedCount: 0,
  noChannelCount: 0,
  lastError: null,
  scheduledAt: null,
  createdById: 'admin',
  startedAt: null,
  sentAt: null,
  createdAt: new Date('2026-10-14T08:00:00Z'),
  updatedAt: new Date('2026-10-14T08:00:00Z'),
};

interface RowWhere {
  id?: string;
  status?: Announcement['status'] | { in: Array<Announcement['status']> };
  updatedAt?: Date | { lt: Date };
}

function matches(a: Announcement, where: RowWhere): boolean {
  if (where.id && where.id !== a.id) return false;
  if (typeof where.status === 'string' && where.status !== a.status) return false;
  if (typeof where.status === 'object' && !where.status.in.includes(a.status)) return false;
  if (where.updatedAt instanceof Date && where.updatedAt.getTime() !== a.updatedAt.getTime()) return false;
  if (where.updatedAt && !(where.updatedAt instanceof Date) && !(a.updatedAt < where.updatedAt.lt)) return false;
  return true;
}

/** Customers: everyone in `users` passes the audience filter unless they turned promotions off. */
function setup(opts: { users: AudienceUser[]; row?: Partial<Announcement>; pushed?: string[]; customers?: number }) {
  let row: Announcement | null = { ...base, ...opts.row };
  const current = () => row as Announcement;
  const deliveries = new Map<string, CampaignDeliveryOutcome>((opts.pushed ?? []).map((id) => [id, 'SENT']));
  const audience = () => opts.users.filter((u) => u.notifyPromotions);
  const userFindMany = jest.fn(({ where }: { where: { id?: { in: string[] }; notifyPromotions?: boolean } }) =>
    Promise.resolve(
      (where.notifyPromotions ? audience() : opts.users).filter((u) => !where.id || where.id.in.includes(u.id)),
    ),
  );
  const prisma = {
    announcement: {
      findUnique: jest.fn(() => Promise.resolve(row)),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(current())),
      findMany: jest.fn(({ where }: { where: { status?: string; scheduledAt?: { lte: Date } } }) =>
        Promise.resolve(
          row &&
            row.status === where.status &&
            (!where.scheduledAt || (row.scheduledAt && row.scheduledAt <= where.scheduledAt.lte))
            ? [row]
            : [],
        ),
      ),
      updateMany: jest.fn(({ where, data }: { where: RowWhere; data: Partial<Announcement> }) => {
        if (!row || !matches(row, where)) return Promise.resolve({ count: 0 });
        row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) };
        return Promise.resolve({ count: 1 });
      }),
      deleteMany: jest.fn(({ where }: { where: RowWhere }) => {
        if (!row || !matches(row, where)) return Promise.resolve({ count: 0 });
        row = null;
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn(({ data }: { data: Partial<Announcement> }) => {
        row = { ...current(), ...data };
        return Promise.resolve(row);
      }),
    },
    user: {
      count: jest.fn(({ where }: { where: { notifyPromotions?: boolean } }) =>
        Promise.resolve(where.notifyPromotions ? audience().length : (opts.customers ?? opts.users.length)),
      ),
      findMany: userFindMany,
    },
    announcementDelivery: {
      findMany: jest.fn(() =>
        Promise.resolve([...deliveries].filter(([, o]) => o === 'SENT').map(([userId]) => ({ userId }))),
      ),
      upsert: jest.fn(({ create }: { create: { userId: string; outcome: CampaignDeliveryOutcome } }) => {
        deliveries.set(create.userId, create.outcome);
        return Promise.resolve(create);
      }),
      groupBy: jest.fn(() => {
        const counts = new Map<CampaignDeliveryOutcome, number>();
        for (const o of deliveries.values()) counts.set(o, (counts.get(o) ?? 0) + 1);
        return Promise.resolve([...counts].map(([outcome, n]) => ({ outcome, _count: { _all: n } })));
      }),
    },
    $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const deliver = jest.fn<Promise<DeliveryResult>, [{ userId: string }, PushMessage]>((r) =>
    Promise.resolve(
      r.userId === 'broken'
        ? { outcome: 'failed', via: [], error: 'FCM 403 PERMISSION_DENIED' }
        : r.userId === 'nobody'
          ? { outcome: 'no_channel', via: [] }
          : { outcome: 'sent', via: ['apns'] },
    ),
  );
  const sendCampaignTo = jest.fn(() => Promise.resolve({ outcome: 'sent', via: ['fcm'] }));
  const notifications = {
    deliver,
    sendCampaignTo,
    transportStatus: () => ({ apns: true, fcm: true, webpush: true, telegram: true }),
  } as unknown as NotificationsService;
  const writeForAnnouncement = jest.fn((_a: unknown, userIds: string[]) =>
    Promise.resolve(new Map(userIds.map((id) => [id, `inbox-${id}`]))),
  );
  const inbox = { writeForAnnouncement } as unknown as InboxService;
  const service = new AnnouncementsService(prisma as unknown as PrismaService, notifications, inbox);
  return { service, prisma, deliver, sendCampaignTo, writeForAnnouncement, deliveries, current, exists: () => !!row };
}

describe('ANNOUNCEMENT_AUDIENCE', () => {
  it('is every active customer who allows promotional notifications', () => {
    expect(ANNOUNCEMENT_AUDIENCE).toEqual({ role: 'CUSTOMER', blockedAt: null, notifyPromotions: true });
  });
});

describe('isRetryable', () => {
  const at = (status: Announcement['status'], failedCount = 0, ageMs = 0) => ({
    status,
    failedCount,
    updatedAt: new Date(Date.now() - ageMs),
  });

  it('retries failed runs, finished runs with failures and stuck ones', () => {
    expect(isRetryable(at('FAILED'))).toBe(true);
    expect(isRetryable(at('SENT', 2))).toBe(true);
    expect(isRetryable(at('SENT'))).toBe(false);
    expect(isRetryable(at('SENDING', 0, 1000))).toBe(false);
    expect(isRetryable(at('SENDING', 0, STALE_SENDING_MS + 1000))).toBe(true);
    expect(isRetryable(at('DRAFT'))).toBe(false);
    expect(isRetryable(at('SCHEDULED'))).toBe(false);
  });
});

describe('AnnouncementsService', () => {
  describe('run', () => {
    it('writes an inbox item for every recipient and pushes it titled from takeAway, with the link', async () => {
      const h = setup({
        users: [user({ id: 'app' }), user({ id: 'nobody' }), user({ id: 'broken' })],
        row: { status: 'SENDING' },
      });
      await h.service.run('a1');

      expect(h.writeForAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', linkStoreId: 's1' }), [
        'app',
        'nobody',
        'broken',
      ]);
      expect(h.deliver).toHaveBeenCalledWith(expect.objectContaining({ userId: 'app' }), {
        kind: 'announcement',
        title: 'takeAway: Новый партнёр',
        body: 'Solo теперь в takeAway',
        notificationId: 'inbox-app',
        storeId: 's1',
      });
      // In the inbox for all three, so the run is SENT even though only one push landed.
      expect(h.current()).toMatchObject({
        status: 'SENT',
        targetCount: 3,
        sentCount: 1,
        failedCount: 1,
        noChannelCount: 1,
        lastError: 'FCM 403 PERMISSION_DENIED',
      });
    });

    it('leaves out everyone who turned promotions off', async () => {
      const h = setup({
        users: [user({ id: 'app' }), user({ id: 'quiet', notifyPromotions: false })],
        row: { status: 'SENDING' },
      });
      await h.service.run('a1');

      expect(h.prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ notifyPromotions: true }) }),
      );
      expect(h.deliver.mock.calls.map(([r]) => r.userId)).toEqual(['app']);
      expect(h.writeForAnnouncement.mock.calls.flatMap(([, ids]) => ids)).toEqual(['app']);
    });

    it('a retry pushes only to the people it missed', async () => {
      const h = setup({
        users: [user({ id: 'app' }), user({ id: 'later' })],
        row: { status: 'SENDING', linkStoreId: null, linkBrandId: 'b1' },
        pushed: ['app'],
      });
      await h.service.run('a1');

      expect(h.deliver.mock.calls.map(([r]) => r.userId)).toEqual(['later']);
      expect(h.deliver.mock.calls[0]?.[1]).toMatchObject({ brandId: 'b1' });
      expect(h.deliver.mock.calls[0]?.[1]).not.toHaveProperty('storeId');
      expect(h.current()).toMatchObject({ status: 'SENT', sentCount: 2, targetCount: 2 });
    });

    it('marks the announcement FAILED with the error when the run crashes', async () => {
      const h = setup({ users: [user({ id: 'app' })], row: { status: 'SENDING' } });
      h.prisma.user.findMany.mockRejectedValueOnce(new Error('connection reset'));
      await expect(h.service.run('a1')).resolves.toBeUndefined();
      expect(h.current()).toMatchObject({ status: 'FAILED', lastError: 'connection reset' });
    });
  });

  describe('send', () => {
    it('sends a draft at once: SENDING, then the background run', async () => {
      const h = setup({ users: [user({ id: 'app' })] });
      const run = jest.spyOn(h.service, 'run').mockResolvedValue(undefined);
      const row = await h.service.send('a1');
      expect(row).toMatchObject({ status: 'SENDING', targetCount: 1 });
      expect(run).toHaveBeenCalledWith('a1');
    });

    it('schedules a draft that has a time, and the cron sends it when the time comes', async () => {
      const at = new Date('2026-10-15T09:00:00Z');
      const h = setup({ users: [user({ id: 'app' })], row: { scheduledAt: at } });
      const run = jest.spyOn(h.service, 'run').mockResolvedValue(undefined);

      await expect(h.service.send('a1', new Date('2026-10-14T12:00:00Z'))).resolves.toMatchObject({
        status: 'SCHEDULED',
      });
      expect(run).not.toHaveBeenCalled();

      await h.service.dispatchDue(new Date('2026-10-15T08:59:00Z'));
      expect(h.current().status).toBe('SCHEDULED');

      await h.service.dispatchDue(new Date('2026-10-15T09:00:00Z'));
      expect(h.current().status).toBe('SENDING');
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('refuses a time that has passed', async () => {
      const h = setup({ users: [user({ id: 'app' })], row: { scheduledAt: new Date('2026-10-14T07:00:00Z') } });
      await expect(h.service.send('a1', new Date('2026-10-14T08:00:00Z'))).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_SCHEDULED_IN_PAST' },
      });
      expect(h.current().status).toBe('DRAFT');
    });

    it('refuses when nobody allows promotions', async () => {
      const h = setup({ users: [user({ id: 'quiet', notifyPromotions: false })] });
      await expect(h.service.send('a1')).rejects.toMatchObject({ response: { code: 'ANNOUNCEMENT_NO_RECIPIENTS' } });
    });

    it('will not start a second run while one is going, nor resend a clean finished one', async () => {
      const going = setup({ users: [user({ id: 'app' })], row: { status: 'SENDING', updatedAt: new Date() } });
      await expect(going.service.send('a1')).rejects.toMatchObject({ response: { code: 'ANNOUNCEMENT_IN_PROGRESS' } });

      const done = setup({ users: [user({ id: 'app' })], row: { status: 'SENT', failedCount: 0 } });
      await expect(done.service.send('a1')).rejects.toMatchObject({ response: { code: 'ANNOUNCEMENT_NOT_SENDABLE' } });
    });

    it('retries a run with failed pushes', async () => {
      const h = setup({ users: [user({ id: 'app' })], row: { status: 'SENT', failedCount: 1 } });
      const run = jest.spyOn(h.service, 'run').mockResolvedValue(undefined);
      await expect(h.service.send('a1')).resolves.toMatchObject({ status: 'SENDING' });
      expect(run).toHaveBeenCalledWith('a1');
    });

    it('cancels a scheduled announcement back to a draft, and nothing else', async () => {
      const h = setup({ users: [], row: { status: 'SCHEDULED' } });
      await expect(h.service.cancel('a1')).resolves.toMatchObject({ status: 'DRAFT' });
      await expect(h.service.cancel('a1')).rejects.toMatchObject({ response: { code: 'ANNOUNCEMENT_NOT_SCHEDULED' } });
    });
  });

  describe('editing', () => {
    it('edits only a draft', async () => {
      const draft = setup({ users: [] });
      await expect(draft.service.update('a1', { title: 'Новое' })).resolves.toMatchObject({ title: 'Новое' });

      const scheduled = setup({ users: [], row: { status: 'SCHEDULED' } });
      await expect(scheduled.service.update('a1', { title: 'Новое' })).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_NOT_EDITABLE' },
      });
    });

    it('deletes a draft or a scheduled one, never one that went out', async () => {
      const scheduled = setup({ users: [], row: { status: 'SCHEDULED' } });
      await scheduled.service.delete('a1');
      expect(scheduled.exists()).toBe(false);

      const sent = setup({ users: [], row: { status: 'SENT' } });
      await expect(sent.service.delete('a1')).rejects.toMatchObject({
        response: { code: 'ANNOUNCEMENT_NOT_DELETABLE' },
      });
    });

    it('marks a run a restart left in SENDING as FAILED', async () => {
      const h = setup({
        users: [],
        row: { status: 'SENDING', updatedAt: new Date(Date.now() - STALE_SENDING_MS - 60_000) },
      });
      await h.service.failStuck();
      expect(h.current().status).toBe('FAILED');
    });
  });

  it('previews who gets it: opted-out customers apart, inbox-only apart from push', async () => {
    const h = setup({
      users: [
        user({ id: 'a', devices: [{ pushToken: 'fcm', type: 'ANDROID' }] }),
        user({ id: 'b', devices: [{ pushToken: '{}', type: 'WEB' }] }),
        user({ id: 'c', telegramUserId: 2n }),
        user({ id: 'd' }),
        user({ id: 'e', notifyPromotions: false, telegramUserId: 3n }),
      ],
    });
    await expect(h.service.preview()).resolves.toEqual({
      customers: 5,
      optedOut: 1,
      recipients: 4,
      pushReachable: 3,
      noChannel: 1,
      byChannel: { appPush: 1, webPush: 1, telegram: 1 },
      transports: { apns: true, fcm: true, webpush: true, telegram: true },
    });
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('sends a test to the admin only, titled and linked like the real thing, without an inbox item', async () => {
    const h = setup({ users: [] });
    await h.service.sendTest('admin', { title: 'Привет', body: 'Текст', linkStoreId: null, linkBrandId: 'b1' });
    expect(h.sendCampaignTo).toHaveBeenCalledWith('admin', 'PUSH', 'takeAway: Привет', 'Текст', {
      ignoreOptOut: true,
      push: { kind: 'announcement', brandId: 'b1' },
    });
    expect(h.writeForAnnouncement).not.toHaveBeenCalled();
  });
});
