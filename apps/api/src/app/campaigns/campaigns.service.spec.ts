import { type Campaign, type CampaignDeliveryOutcome, Prisma } from '@prisma/client';

import type { InboxService } from '../inbox/inbox.service';
import type { MailService } from '../mail/mail.service';
import type { DeliveryResult, NotificationsService } from '../notifications/notifications.service';
import type { PushMessage } from '../notifications/providers/push-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import {
  type AudienceUser,
  CampaignsService,
  STALE_SENDING_MS,
  type Transports,
  audienceWhere,
  isDue,
  isSendable,
  reachOf,
} from './campaigns.service';

const allOn: Transports = { apns: true, fcm: true, webpush: true, telegram: true, email: true };

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

describe('audienceWhere', () => {
  it('ALL means any tie to the brand: an order in any status, a cart or a bought gift card', () => {
    expect(audienceWhere('b1', 'ALL')).toEqual({
      role: 'CUSTOMER',
      blockedAt: null,
      OR: [
        { orders: { some: { store: { brandId: 'b1' } } } },
        { carts: { some: { store: { brandId: 'b1' } } } },
        { giftCardsPurchased: { some: { brandId: 'b1' } } },
      ],
    });
  });

  it('HAS_ORDERED needs a paid order at the brand', () => {
    const where = audienceWhere('b1', 'HAS_ORDERED');
    expect(where).toMatchObject({ role: 'CUSTOMER', blockedAt: null, orders: { some: { store: { brandId: 'b1' } } } });
    expect((where.orders?.some?.status as { in: string[] }).in).toContain('PAID');
    expect((where.orders?.some?.status as { in: string[] }).in).not.toContain('CREATED');
  });

  it('INACTIVE_30D excludes anyone who paid in the last 30 days', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const where = audienceWhere('b1', 'INACTIVE_30D', now);
    expect(where.orders?.none).toMatchObject({ createdAt: { gt: new Date('2026-09-04T12:00:00Z') } });
  });
});

describe('reachOf', () => {
  it('uses the app push for a customer with a mobile token', () => {
    const u = user({ devices: [{ pushToken: 'fcm', type: 'ANDROID' }], telegramUserId: 7n });
    expect(reachOf(u, 'PUSH', allOn)).toEqual({
      kind: 'reachable',
      appPush: true,
      webPush: false,
      telegram: false,
      email: false,
    });
  });

  it('falls back to Telegram for a Mini App customer', () => {
    expect(reachOf(user({ telegramUserId: 7n }), 'PUSH', allOn)).toMatchObject({ kind: 'reachable', telegram: true });
  });

  it('falls back to Telegram when the server cannot send app push', () => {
    const u = user({ devices: [{ pushToken: 'fcm', type: 'IOS' }], telegramUserId: 7n });
    expect(reachOf(u, 'PUSH', { ...allOn, fcm: false })).toMatchObject({ appPush: false, telegram: true });
  });

  it('reaches an iPhone with an APNs token through Apple even without FCM', () => {
    const iphone = { pushToken: 'fcm', type: 'IOS', apnsToken: 'ab'.repeat(32), apnsEnvironment: null } as const;
    expect(reachOf(user({ devices: [iphone] }), 'PUSH', { ...allOn, fcm: false })).toMatchObject({
      kind: 'reachable',
      appPush: true,
    });
    expect(reachOf(user({ devices: [iphone] }), 'PUSH', { ...allOn, fcm: false, apns: false })).toEqual({
      kind: 'no_channel',
    });
  });

  it('counts opted-out and unreachable people apart', () => {
    expect(reachOf(user({ notifyPromotions: false, telegramUserId: 7n }), 'PUSH', allOn)).toEqual({
      kind: 'opted_out',
    });
    expect(reachOf(user(), 'PUSH', allOn)).toEqual({ kind: 'no_channel' });
    expect(reachOf(user({ telegramUserId: 7n }), 'PUSH', { ...allOn, telegram: false })).toEqual({
      kind: 'no_channel',
    });
    expect(reachOf(user({ telegramUserId: 7n }), 'EMAIL', allOn)).toEqual({ kind: 'no_channel' });
  });
});

describe('isSendable', () => {
  const approvedAt = new Date('2026-10-10T08:00:00Z');
  const at = (status: Campaign['status'], failedCount = 0, ageMs = 0, approved: Date | null = approvedAt) => ({
    status,
    failedCount,
    updatedAt: new Date(Date.now() - ageMs),
    approvedAt: approved,
  });

  it('retries approved failed runs and finished runs with failures', () => {
    expect(isSendable(at('FAILED'))).toBe(true);
    expect(isSendable(at('SENT', 3))).toBe(true);
    expect(isSendable(at('SENT', 0))).toBe(false);
  });

  it('allows a SENDING row only once it is stuck', () => {
    expect(isSendable(at('SENDING', 0, 1000))).toBe(false);
    expect(isSendable(at('SENDING', 0, STALE_SENDING_MS + 1000))).toBe(true);
  });

  it('never starts a first run: drafts and campaigns in review are sent by approval only', () => {
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED'] as const) {
      expect(isSendable(at(status))).toBe(false);
    }
  });

  it('refuses every unapproved campaign, whatever its status says', () => {
    for (const status of ['FAILED', 'SENT', 'SENDING'] as const) {
      expect(isSendable(at(status, 3, STALE_SENDING_MS + 1000, null))).toBe(false);
    }
  });
});

describe('isDue', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const approvedAt = new Date('2026-10-10T11:00:00Z');

  it('is due once approved, at once or when the scheduled time has come', () => {
    expect(isDue({ status: 'APPROVED', approvedAt, scheduledAt: null }, now)).toBe(true);
    expect(isDue({ status: 'APPROVED', approvedAt, scheduledAt: new Date('2026-10-10T11:59:00Z') }, now)).toBe(true);
    expect(isDue({ status: 'APPROVED', approvedAt, scheduledAt: new Date('2026-10-10T12:01:00Z') }, now)).toBe(false);
  });

  it('is never due without approval', () => {
    expect(isDue({ status: 'APPROVED', approvedAt: null, scheduledAt: null }, now)).toBe(false);
    expect(isDue({ status: 'PENDING_REVIEW', approvedAt: null, scheduledAt: null }, now)).toBe(false);
    expect(isDue({ status: 'DRAFT', approvedAt: null, scheduledAt: null }, now)).toBe(false);
  });
});

describe('CampaignsService', () => {
  const baseCampaign: Campaign = {
    id: 'c1',
    brandId: 'b1',
    title: 'Скидка',
    body: '−20% на капучино',
    channel: 'PUSH',
    audience: 'ALL',
    inactiveDays: null,
    segmentStoreId: null,
    status: 'DRAFT',
    targetCount: 0,
    sentCount: 0,
    failedCount: 0,
    noChannelCount: 0,
    optedOutCount: 0,
    lastError: null,
    scheduledAt: null,
    createdById: 'owner',
    submittedAt: null,
    reviewedAt: null,
    reviewedById: null,
    reviewNote: null,
    approvedAt: null,
    startedAt: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const approved = { approvedAt: new Date('2026-10-10T08:00:00Z') };

  /** What a conditional update matches on, as the service writes it. */
  interface CampaignWhere {
    id?: string;
    brandId?: string;
    status?: Campaign['status'] | { in: Array<Campaign['status']> };
    approvedAt?: { not: null };
  }

  function matches(c: Campaign, where: CampaignWhere): boolean {
    if (where.id && where.id !== c.id) return false;
    if (where.brandId && where.brandId !== c.brandId) return false;
    if (typeof where.status === 'string' && where.status !== c.status) return false;
    if (typeof where.status === 'object' && !where.status.in.includes(c.status)) return false;
    if (where.approvedAt && c.approvedAt === null) return false;
    return true;
  }

  function setup(opts: {
    users: AudienceUser[];
    campaign?: Partial<Campaign>;
    delivered?: string[];
    inactive?: string[];
  }) {
    let campaign: Campaign | null = { ...baseCampaign, ...opts.campaign };
    const current = (): Campaign => campaign as Campaign;
    const queries: Prisma.Sql[] = [];
    const deliveries = new Map<string, { outcome: CampaignDeliveryOutcome; error: string | null }>(
      (opts.delivered ?? []).map((id) => [id, { outcome: 'SENT', error: null }]),
    );
    const update = jest.fn(({ data }: { data: Partial<Campaign> }) => {
      campaign = { ...current(), ...data };
      return Promise.resolve(campaign);
    });
    const prisma = {
      campaign: {
        findUnique: jest.fn(() => Promise.resolve(campaign)),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(current())),
        findMany: jest.fn(() => Promise.resolve(campaign ? [{ id: campaign.id }] : [])),
        updateMany: jest.fn(({ where, data }: { where: CampaignWhere; data: Partial<Campaign> }) => {
          if (!campaign || !matches(campaign, where)) return Promise.resolve({ count: 0 });
          campaign = { ...campaign, ...data };
          return Promise.resolve({ count: 1 });
        }),
        deleteMany: jest.fn(({ where }: { where: CampaignWhere }) => {
          if (!campaign || !matches(campaign, where)) return Promise.resolve({ count: 0 });
          campaign = null;
          return Promise.resolve({ count: 1 });
        }),
        update,
      },
      user: {
        count: jest.fn(() => Promise.resolve(opts.users.length)),
        findMany: jest.fn(({ where }: { where: { id?: { in: string[] } } }) =>
          Promise.resolve(where.id ? opts.users.filter((u) => where.id?.in.includes(u.id)) : opts.users),
        ),
      },
      campaignDelivery: {
        findMany: jest.fn(() =>
          Promise.resolve(
            [...deliveries.entries()].filter(([, d]) => d.outcome === 'SENT').map(([userId]) => ({ userId })),
          ),
        ),
        upsert: jest.fn(
          ({ create }: { create: { userId: string; outcome: CampaignDeliveryOutcome; error: string | null } }) => {
            deliveries.set(create.userId, { outcome: create.outcome, error: create.error });
            return Promise.resolve(create);
          },
        ),
        groupBy: jest.fn(() => {
          const counts = new Map<CampaignDeliveryOutcome, number>();
          for (const d of deliveries.values()) counts.set(d.outcome, (counts.get(d.outcome) ?? 0) + 1);
          return Promise.resolve([...counts].map(([outcome, n]) => ({ outcome, _count: { _all: n } })));
        }),
      },
      brand: { findUnique: jest.fn(() => Promise.resolve({ name: 'NoName Coffee' })) },
      $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
      // The inactive segment lookup.
      $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        queries.push(Prisma.sql(strings, ...values));
        return Promise.resolve((opts.inactive ?? []).map((userId) => ({ userId })));
      }),
    };
    const deliver = jest.fn<Promise<DeliveryResult>, [{ userId: string }, PushMessage, ...unknown[]]>((r) =>
      Promise.resolve(
        r.userId === 'tg'
          ? { outcome: 'sent', via: ['telegram'] }
          : r.userId === 'fallback'
            ? { outcome: 'sent', via: ['telegram'], error: 'FCM 401 UNAUTHENTICATED: Invalid APNs credential.' }
            : r.userId === 'broken'
              ? { outcome: 'failed', via: [], error: 'FCM 403 PERMISSION_DENIED' }
              : r.userId === 'nobody'
                ? { outcome: 'no_channel', via: [] }
                : { outcome: 'sent', via: ['fcm'] },
      ),
    );
    const notifications = {
      deliver,
      transportStatus: () => ({ apns: true, fcm: true, webpush: true, telegram: true }),
    } as unknown as NotificationsService;
    const mail = { isConfigured: () => true, send: jest.fn() } as unknown as MailService;
    const writeForCampaign = jest.fn((_c: unknown, userIds: string[]) =>
      Promise.resolve(new Map(userIds.map((id) => [id, `inbox-${id}`]))),
    );
    const inbox = { writeForCampaign } as unknown as InboxService;
    const service = new CampaignsService(prisma as unknown as PrismaService, notifications, mail, inbox);
    return {
      service,
      prisma,
      deliver,
      deliveries,
      queries,
      current,
      writeForCampaign,
      exists: () => campaign !== null,
    };
  }

  it('refuses to retry to an empty audience instead of finishing "0 / 0"', async () => {
    const h = setup({ users: [], campaign: { status: 'FAILED', ...approved } });
    await expect(h.service.send('b1', 'c1')).rejects.toMatchObject({
      response: { code: 'CAMPAIGN_NO_RECIPIENTS' },
    });
    expect(h.prisma.campaign.updateMany).not.toHaveBeenCalled();
  });

  it('answers a retry at once with SENDING and does the fan-out in the background', async () => {
    const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'FAILED', ...approved } });
    const runs: Array<Promise<void>> = [];
    jest.spyOn(h.service, 'run').mockImplementation((id) => {
      runs.push(Promise.resolve(id).then(() => undefined));
      return runs[0] as Promise<void>;
    });
    const row = await h.service.send('b1', 'c1');
    expect(row.status).toBe('SENDING');
    expect(row.targetCount).toBe(1);
    expect(runs).toHaveLength(1);
  });

  it('counts sent, failed, unreachable and opted-out people and keeps the last error', async () => {
    const h = setup({
      users: [
        user({ id: 'app' }),
        user({ id: 'tg', telegramUserId: 7n }),
        user({ id: 'broken' }),
        user({ id: 'nobody' }),
        user({ id: 'quiet', notifyPromotions: false }),
      ],
      campaign: { status: 'SENDING', ...approved },
    });
    await h.service.run('c1');
    expect(h.current()).toMatchObject({
      status: 'SENT',
      targetCount: 5,
      sentCount: 2,
      failedCount: 1,
      noChannelCount: 1,
      optedOutCount: 1,
      lastError: 'FCM 403 PERMISSION_DENIED',
    });
    // The opted-out customer is never handed to a transport.
    expect(h.deliver.mock.calls.map(([r]) => r.userId)).not.toContain('quiet');
  });

  it('ends FAILED with a reason when nobody could be reached', async () => {
    const h = setup({ users: [user({ id: 'nobody' })], campaign: { status: 'SENDING', ...approved } });
    await h.service.run('c1');
    expect(h.current().status).toBe('FAILED');
    expect(h.current().lastError).toMatch(/Nobody could be reached/);
  });

  it('marks the campaign FAILED with the error when the run crashes', async () => {
    const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'SENDING', ...approved } });
    h.prisma.user.findMany.mockRejectedValueOnce(new Error('connection reset'));
    await expect(h.service.run('c1')).resolves.toBeUndefined();
    expect(h.current()).toMatchObject({ status: 'FAILED', lastError: 'connection reset' });
  });

  it('a retry skips everyone who already received the campaign', async () => {
    const h = setup({
      users: [user({ id: 'app' }), user({ id: 'tg', telegramUserId: 7n })],
      campaign: { status: 'FAILED', ...approved },
      delivered: ['app'],
    });
    await h.service.run('c1');
    expect(h.deliver.mock.calls.map(([r]) => r.userId)).toEqual(['tg']);
    expect(h.current()).toMatchObject({ status: 'SENT', sentCount: 2, targetCount: 2 });
  });

  it('will not start a second run while one is going', async () => {
    const h = setup({
      users: [user({ id: 'app' })],
      campaign: { status: 'SENDING', updatedAt: new Date(), ...approved },
    });
    await expect(h.service.send('b1', 'c1')).rejects.toMatchObject({ response: { code: 'CAMPAIGN_IN_PROGRESS' } });
  });

  it('previews the reach by channel before anything is sent', async () => {
    const h = setup({
      users: [
        user({ id: 'a', devices: [{ pushToken: 'fcm', type: 'ANDROID' }] }),
        user({ id: 'b', devices: [{ pushToken: '{}', type: 'WEB' }], telegramUserId: 1n }),
        user({ id: 'c', telegramUserId: 2n }),
        user({ id: 'd' }),
        user({ id: 'e', notifyPromotions: false }),
      ],
    });
    await expect(h.service.preview('b1', { audience: 'ALL' }, 'PUSH')).resolves.toEqual({
      total: 5,
      reachable: 3,
      optedOut: 1,
      noChannel: 1,
      byChannel: { appPush: 1, webPush: 1, telegram: 1, email: 0 },
      transports: { apns: true, fcm: true, webpush: true, telegram: true, email: true },
    });
    expect(h.deliver).not.toHaveBeenCalled();
  });

  describe('moderation gate', () => {
    it.each(['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED'] as const)(
      'refuses "send" on a %s campaign: only approval starts a first run',
      async (status) => {
        const h = setup({ users: [user({ id: 'app' })], campaign: { status } });
        await expect(h.service.send('b1', 'c1')).rejects.toMatchObject({
          response: { code: 'CAMPAIGN_NOT_SENDABLE' },
        });
        expect(h.current().status).toBe(status);
        expect(h.deliver).not.toHaveBeenCalled();
      },
    );

    it('refuses to retry a failed campaign that was never approved (one from before moderation)', async () => {
      const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'FAILED' } });
      await expect(h.service.send('b1', 'c1')).rejects.toMatchObject({
        response: { code: 'CAMPAIGN_NOT_SENDABLE', message: 'The campaign has not been approved' },
      });
      expect(h.deliver).not.toHaveBeenCalled();
    });

    it.each(['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SENDING', 'FAILED'] as const)(
      'a run of an unapproved %s campaign reaches nobody, whoever started it',
      async (status) => {
        const h = setup({ users: [user({ id: 'app' }), user({ id: 'tg', telegramUserId: 7n })], campaign: { status } });
        await h.service.run('c1');
        expect(h.deliver).not.toHaveBeenCalled();
        expect(h.prisma.campaignDelivery.upsert).not.toHaveBeenCalled();
        expect(h.current().status).toBe(status);
      },
    );

    it('starts an approved campaign that is due, and only once', async () => {
      const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'APPROVED', ...approved } });
      const run = jest.spyOn(h.service, 'run').mockResolvedValue(undefined);

      await expect(h.service.startIfDue('c1')).resolves.toBe(true);
      await expect(h.service.startIfDue('c1')).resolves.toBe(false);

      expect(h.current()).toMatchObject({ status: 'SENDING', targetCount: 1 });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('waits for the scheduled time', async () => {
      const at = new Date('2026-10-12T09:00:00Z');
      const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'APPROVED', scheduledAt: at, ...approved } });
      const run = jest.spyOn(h.service, 'run').mockResolvedValue(undefined);

      await expect(h.service.startIfDue('c1', new Date('2026-10-12T08:59:00Z'))).resolves.toBe(false);
      expect(h.current().status).toBe('APPROVED');

      await expect(h.service.startIfDue('c1', new Date('2026-10-12T09:00:00Z'))).resolves.toBe(true);
      expect(run).toHaveBeenCalledWith('c1');
    });

    it('never starts a campaign marked APPROVED without an approval stamp', async () => {
      const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'APPROVED' } });
      const run = jest.spyOn(h.service, 'run').mockResolvedValue(undefined);

      await expect(h.service.startIfDue('c1')).resolves.toBe(false);
      await h.service.dispatchDue();

      expect(h.current().status).toBe('APPROVED');
      expect(run).not.toHaveBeenCalled();
    });

    it('ends an approved campaign FAILED when its audience emptied since the review', async () => {
      const h = setup({ users: [], campaign: { status: 'APPROVED', ...approved } });
      const run = jest.spyOn(h.service, 'run').mockResolvedValue(undefined);

      await expect(h.service.startIfDue('c1')).resolves.toBe(false);

      expect(h.current()).toMatchObject({ status: 'FAILED', lastError: 'Nobody matches this audience' });
      expect(run).not.toHaveBeenCalled();
    });

    it('the scheduler asks only for approved campaigns whose time has come', async () => {
      const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'APPROVED', ...approved } });
      jest.spyOn(h.service, 'run').mockResolvedValue(undefined);
      const now = new Date('2026-10-12T09:00:00Z');

      await h.service.dispatchDue(now);

      expect(h.prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'APPROVED',
            approvedAt: { not: null },
            OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
          },
        }),
      );
      expect(h.current().status).toBe('SENDING');
    });
  });

  describe('editing and deleting', () => {
    it('edits a draft and a rejected campaign, keeping the rejection reason until resubmit', async () => {
      const h = setup({ users: [], campaign: { status: 'REJECTED', reviewNote: 'Уберите капс' } });
      await expect(h.service.update('b1', 'c1', { title: 'Скидка 20%' })).resolves.toMatchObject({
        title: 'Скидка 20%',
        status: 'REJECTED',
        reviewNote: 'Уберите капс',
      });
    });

    it.each(['PENDING_REVIEW', 'APPROVED', 'SENDING', 'SENT'] as const)(
      'refuses to edit a %s campaign, so nothing changes under the moderator',
      async (status) => {
        const h = setup({ users: [], campaign: { status, ...approved } });
        await expect(h.service.update('b1', 'c1', { body: 'other copy' })).rejects.toMatchObject({
          response: { code: 'CAMPAIGN_NOT_EDITABLE' },
        });
        expect(h.current().body).toBe(baseCampaign.body);
      },
    );

    it('404s another brand’s campaign instead of editing it', async () => {
      const h = setup({ users: [] });
      await expect(h.service.update('b2', 'c1', { title: 'x' })).rejects.toMatchObject({ status: 404 });
    });

    it('deletes anything that has not started going out, and nothing that has', async () => {
      const waiting = setup({ users: [], campaign: { status: 'APPROVED', ...approved } });
      await waiting.service.delete('b1', 'c1');
      expect(waiting.exists()).toBe(false);

      const sent = setup({ users: [], campaign: { status: 'SENT', ...approved } });
      await expect(sent.service.delete('b1', 'c1')).rejects.toMatchObject({
        response: { code: 'CAMPAIGN_NOT_DELETABLE' },
      });
      expect(sent.exists()).toBe(true);
    });

    it('a new audience brings its segment along, and another audience clears it', async () => {
      const h = setup({ users: [] });
      await expect(
        h.service.update('b1', 'c1', { audience: 'INACTIVE', inactiveDays: 7, segmentStoreId: 's1' }),
      ).resolves.toMatchObject({ audience: 'INACTIVE', inactiveDays: 7, segmentStoreId: 's1' });
      await expect(h.service.update('b1', 'c1', { audience: 'ALL' })).resolves.toMatchObject({
        audience: 'ALL',
        inactiveDays: null,
        segmentStoreId: null,
      });
    });
  });

  it('INACTIVE reaches only the inactive segment, at the chosen store', async () => {
    const h = setup({
      users: [user({ id: 'gone', telegramUserId: 1n }), user({ id: 'regular', telegramUserId: 2n })],
      inactive: ['gone'],
    });
    const preview = await h.service.preview(
      'b1',
      { audience: 'INACTIVE', inactiveDays: 7, segmentStoreId: 's1' },
      'TELEGRAM',
    );
    expect(preview).toMatchObject({ total: 1, reachable: 1 });
    const sql = h.queries[0];
    expect(sql?.sql).toContain('p."orders" >=');
    expect(sql?.values).toEqual(expect.arrayContaining([['b1'], ['s1'], 3]));
  });

  it('sends an INACTIVE campaign to the people inactive at the moment of sending', async () => {
    const h = setup({
      users: [user({ id: 'gone' }), user({ id: 'regular' })],
      inactive: ['gone'],
      campaign: { audience: 'INACTIVE', inactiveDays: 14, status: 'SENDING', ...approved },
    });
    await h.service.run('c1');
    expect([...h.deliveries.keys()]).toEqual(['gone']);
    expect(h.current()).toMatchObject({ status: 'SENT', targetCount: 1 });
  });

  it('moderation sees the reach of an INACTIVE campaign, not of the whole brand', async () => {
    const h = setup({
      users: [user({ id: 'gone', telegramUserId: 1n }), user({ id: 'regular', telegramUserId: 2n })],
      inactive: ['gone'],
      campaign: { audience: 'INACTIVE', inactiveDays: 7, segmentStoreId: null },
    });
    await expect(h.service.preview('b1', h.current(), 'TELEGRAM')).resolves.toMatchObject({ total: 1 });
    expect(h.queries).toHaveLength(1);
  });

  describe('inbox and sender', () => {
    it('gives everyone who allows promotions an inbox item and pushes it under the brand name', async () => {
      const h = setup({
        users: [user({ id: 'app' }), user({ id: 'nobody' }), user({ id: 'quiet', notifyPromotions: false })],
        campaign: { status: 'SENDING', ...approved },
      });
      await h.service.run('c1');

      // The unreachable customer gets an item too; the opted-out one gets nothing.
      expect(h.writeForCampaign).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', brandId: 'b1' }), [
        'app',
        'nobody',
      ]);
      expect(h.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'app' }),
        {
          kind: 'campaign',
          title: 'NoName Coffee: Скидка',
          body: '−20% на капучино',
          notificationId: 'inbox-app',
        },
        'push',
      );
    });

    it('titles a Telegram campaign with the brand too, without an inbox item', async () => {
      const h = setup({
        users: [user({ id: 'tg', telegramUserId: 7n })],
        campaign: { status: 'SENDING', channel: 'TELEGRAM', ...approved },
      });
      await h.service.run('c1');

      expect(h.writeForCampaign).not.toHaveBeenCalled();
      expect(h.deliver).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'campaign', title: 'NoName Coffee: Скидка' }),
        'telegram',
      );
      expect(h.deliver.mock.calls[0]?.[1]).not.toHaveProperty('notificationId');
    });

    it('writes no inbox item for an email campaign', async () => {
      const h = setup({
        users: [user({ id: 'mail', email: 'a@b.c' })],
        campaign: { status: 'SENDING', channel: 'EMAIL', ...approved },
      });
      await h.service.run('c1');
      expect(h.writeForCampaign).not.toHaveBeenCalled();
      expect(h.current().sentCount).toBe(1);
    });
  });

  it('keeps why the app push failed when the Telegram fallback still delivered', async () => {
    const h = setup({
      users: [user({ id: 'fallback', telegramUserId: 7n })],
      campaign: { status: 'SENDING', ...approved },
    });
    await h.service.run('c1');
    expect(h.deliveries.get('fallback')).toEqual({
      outcome: 'SENT',
      error: 'FCM 401 UNAUTHENTICATED: Invalid APNs credential.',
    });
    expect(h.current()).toMatchObject({
      status: 'SENT',
      sentCount: 1,
      failedCount: 0,
      lastError: 'FCM 401 UNAUTHENTICATED: Invalid APNs credential.',
    });
  });
});

describe('CampaignsService.create', () => {
  function create() {
    const prisma = { campaign: { create: jest.fn(({ data }: { data: unknown }) => Promise.resolve(data)) } };
    const service = new CampaignsService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
      {} as MailService,
      {} as InboxService,
    );
    return { service, prisma };
  }
  const copy = {
    brandId: 'b1',
    createdById: 'owner',
    title: 'Скучаем',
    body: 'Возвращайтесь',
    channel: 'PUSH' as const,
    scheduledAt: null,
  };

  it('keeps the days and the store of an INACTIVE audience, 14 days by default', async () => {
    const { service, prisma } = create();
    await service.create({ ...copy, audience: 'INACTIVE', segmentStoreId: 's1' });
    expect(prisma.campaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audience: 'INACTIVE', inactiveDays: 14, segmentStoreId: 's1', status: 'DRAFT' }),
    });
  });

  it('drops them for any other audience', async () => {
    const { service, prisma } = create();
    await service.create({ ...copy, audience: 'ALL', inactiveDays: 7, segmentStoreId: 's1' });
    expect(prisma.campaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audience: 'ALL', inactiveDays: null, segmentStoreId: null }),
    });
  });
});

describe('CampaignsService.stats', () => {
  it('counts people per transport and lists the most common errors first', async () => {
    const groupBy = jest.fn(({ by }: { by: string[] }) =>
      Promise.resolve(
        by.includes('via')
          ? [
              { campaignId: 'c1', via: 'apns', _count: { _all: 3 } },
              { campaignId: 'c1', via: 'apns,webpush', _count: { _all: 1 } },
              { campaignId: 'c1', via: 'telegram', _count: { _all: 2 } },
              { campaignId: 'c2', via: 'email', _count: { _all: 5 } },
            ]
          : [
              { campaignId: 'c1', error: 'Telegram 403: bot was blocked by the user', _count: { _all: 1 } },
              { campaignId: 'c1', error: 'FCM 401 UNAUTHENTICATED: Invalid APNs credential.', _count: { _all: 4 } },
              { campaignId: 'c1', error: 'APNs 500 InternalServerError', _count: { _all: 2 } },
              { campaignId: 'c1', error: 'WebPush 500: oops', _count: { _all: 1 } },
            ],
      ),
    );
    const prisma = { campaignDelivery: { groupBy } } as unknown as PrismaService;
    const service = new CampaignsService(prisma, {} as NotificationsService, {} as MailService, {} as InboxService);

    const stats = await service.stats(['c1', 'c2', 'c3']);

    expect(stats.get('c1')).toEqual({
      via: { apns: 4, fcm: 0, webpush: 1, telegram: 2, email: 0 },
      errors: [
        { error: 'FCM 401 UNAUTHENTICATED: Invalid APNs credential.', count: 4 },
        { error: 'APNs 500 InternalServerError', count: 2 },
        { error: 'Telegram 403: bot was blocked by the user', count: 1 },
      ],
    });
    expect(stats.get('c2')?.via.email).toBe(5);
    expect(stats.get('c3')).toEqual({ via: { apns: 0, fcm: 0, webpush: 0, telegram: 0, email: 0 }, errors: [] });
  });

  it('does not query for an empty list', async () => {
    const groupBy = jest.fn();
    const prisma = { campaignDelivery: { groupBy } } as unknown as PrismaService;
    const service = new CampaignsService(prisma, {} as NotificationsService, {} as MailService, {} as InboxService);
    await expect(service.stats([])).resolves.toEqual(new Map());
    expect(groupBy).not.toHaveBeenCalled();
  });
});
