import type { Campaign, CampaignDeliveryOutcome } from '@prisma/client';

import type { MailService } from '../mail/mail.service';
import type { DeliveryResult, NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  type AudienceUser,
  CampaignsService,
  STALE_SENDING_MS,
  type Transports,
  audienceWhere,
  isSendable,
  reachOf,
} from './campaigns.service';

const allOn: Transports = { fcm: true, webpush: true, telegram: true, email: true };

function user(over: Partial<AudienceUser> = {}): AudienceUser {
  return {
    id: 'u1',
    locale: 'RU',
    telegramUserId: null,
    email: null,
    notifyPromotions: true,
    devices: [],
    ...over,
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
  const at = (status: Campaign['status'], failedCount = 0, ageMs = 0) => ({
    status,
    failedCount,
    updatedAt: new Date(Date.now() - ageMs),
  });

  it('allows drafts, failed runs and finished runs with failures', () => {
    expect(isSendable(at('DRAFT'))).toBe(true);
    expect(isSendable(at('FAILED'))).toBe(true);
    expect(isSendable(at('SENT', 3))).toBe(true);
    expect(isSendable(at('SENT', 0))).toBe(false);
  });

  it('allows a SENDING row only once it is stuck', () => {
    expect(isSendable(at('SENDING', 0, 1000))).toBe(false);
    expect(isSendable(at('SENDING', 0, STALE_SENDING_MS + 1000))).toBe(true);
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
    status: 'DRAFT',
    targetCount: 0,
    sentCount: 0,
    failedCount: 0,
    noChannelCount: 0,
    optedOutCount: 0,
    lastError: null,
    scheduledAt: null,
    startedAt: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setup(opts: { users: AudienceUser[]; campaign?: Partial<Campaign>; delivered?: string[] }) {
    let campaign: Campaign = { ...baseCampaign, ...opts.campaign };
    const deliveries = new Map<string, { outcome: CampaignDeliveryOutcome; error: string | null }>(
      (opts.delivered ?? []).map((id) => [id, { outcome: 'SENT', error: null }]),
    );
    const update = jest.fn(({ data }: { data: Partial<Campaign> }) => {
      campaign = { ...campaign, ...data };
      return Promise.resolve(campaign);
    });
    const prisma = {
      campaign: {
        findUnique: jest.fn(() => Promise.resolve(campaign)),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(campaign)),
        updateMany: jest.fn(({ data }: { data: Partial<Campaign> }) => {
          campaign = { ...campaign, ...data };
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
      $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
    };
    const deliver = jest.fn<Promise<DeliveryResult>, [{ userId: string }]>((r) =>
      Promise.resolve(
        r.userId === 'tg'
          ? { outcome: 'sent', via: ['telegram'] }
          : r.userId === 'broken'
            ? { outcome: 'failed', via: [], error: 'FCM 403 PERMISSION_DENIED' }
            : r.userId === 'nobody'
              ? { outcome: 'no_channel', via: [] }
              : { outcome: 'sent', via: ['fcm'] },
      ),
    );
    const notifications = {
      deliver,
      transportStatus: () => ({ fcm: true, webpush: true, telegram: true }),
    } as unknown as NotificationsService;
    const mail = { isConfigured: () => true, send: jest.fn() } as unknown as MailService;
    const service = new CampaignsService(prisma as unknown as PrismaService, notifications, mail);
    return { service, prisma, deliver, deliveries, current: () => campaign };
  }

  it('refuses to send to an empty audience instead of finishing "0 / 0"', async () => {
    const h = setup({ users: [] });
    await expect(h.service.send('b1', 'c1')).rejects.toMatchObject({
      response: { code: 'CAMPAIGN_NO_RECIPIENTS' },
    });
    expect(h.prisma.campaign.updateMany).not.toHaveBeenCalled();
  });

  it('answers at once with SENDING and does the fan-out in the background', async () => {
    const h = setup({ users: [user({ id: 'app' })] });
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
      campaign: { status: 'SENDING' },
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
    const h = setup({ users: [user({ id: 'nobody' })], campaign: { status: 'SENDING' } });
    await h.service.run('c1');
    expect(h.current().status).toBe('FAILED');
    expect(h.current().lastError).toMatch(/Nobody could be reached/);
  });

  it('marks the campaign FAILED with the error when the run crashes', async () => {
    const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'SENDING' } });
    h.prisma.user.findMany.mockRejectedValueOnce(new Error('connection reset'));
    await expect(h.service.run('c1')).resolves.toBeUndefined();
    expect(h.current()).toMatchObject({ status: 'FAILED', lastError: 'connection reset' });
  });

  it('a retry skips everyone who already received the campaign', async () => {
    const h = setup({
      users: [user({ id: 'app' }), user({ id: 'tg', telegramUserId: 7n })],
      campaign: { status: 'FAILED' },
      delivered: ['app'],
    });
    await h.service.run('c1');
    expect(h.deliver.mock.calls.map(([r]) => r.userId)).toEqual(['tg']);
    expect(h.current()).toMatchObject({ status: 'SENT', sentCount: 2, targetCount: 2 });
  });

  it('will not start a second run while one is going', async () => {
    const h = setup({ users: [user({ id: 'app' })], campaign: { status: 'SENDING', updatedAt: new Date() } });
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
    await expect(h.service.preview('b1', 'ALL', 'PUSH')).resolves.toEqual({
      total: 5,
      reachable: 3,
      optedOut: 1,
      noChannel: 1,
      byChannel: { appPush: 1, webPush: 1, telegram: 1, email: 0 },
      transports: { fcm: true, webpush: true, telegram: true, email: true },
    });
    expect(h.deliver).not.toHaveBeenCalled();
  });
});
