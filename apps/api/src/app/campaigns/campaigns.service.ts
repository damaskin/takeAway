import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  Campaign,
  CampaignAudience,
  CampaignChannel,
  CampaignDeliveryOutcome,
  OrderStatus,
  Prisma,
} from '@prisma/client';

import { MailService } from '../mail/mail.service';
import {
  type DeliveryVia,
  NotificationsService,
  PUSH_RECIPIENT_SELECT,
  toPushRecipient,
} from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const SEND_BATCH_SIZE = 50;

/**
 * A SENDING campaign whose row has not moved for this long is stuck — the
 * run refreshes its counters after every batch, and a batch is bounded by
 * the 10 s provider timeouts. Most likely the API restarted mid-run.
 */
export const STALE_SENDING_MS = 10 * 60_000;

/** An order in one of these has been paid for (or is being made). */
const PAID_STATUSES: OrderStatus[] = [
  'PAID',
  'ACCEPTED',
  'IN_PROGRESS',
  'READY',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/** Everything a run or a preview needs to know about one recipient. */
const AUDIENCE_USER_SELECT = {
  ...PUSH_RECIPIENT_SELECT,
  email: true,
  notifyPromotions: true,
} as const;

export type AudienceUser = Prisma.UserGetPayload<{ select: typeof AUDIENCE_USER_SELECT }>;

/** Which transports the server has credentials for. */
export interface Transports {
  fcm: boolean;
  webpush: boolean;
  telegram: boolean;
  email: boolean;
}

/** How a campaign would reach one person, given what is configured. */
export type Reach =
  | { kind: 'opted_out' }
  | { kind: 'no_channel' }
  | { kind: 'reachable'; appPush: boolean; webPush: boolean; telegram: boolean; email: boolean };

export interface CampaignPreview {
  /** Everyone the audience filter matches. */
  total: number;
  /** Of those, the people some channel can actually reach. */
  reachable: number;
  optedOut: number;
  noChannel: number;
  byChannel: { appPush: number; webPush: number; telegram: number; email: number };
  transports: Transports;
}

export interface TestSendResult {
  outcome: 'sent' | 'failed' | 'no_channel';
  via: Array<DeliveryVia | 'email'>;
  error?: string;
}

interface DeliveryRecord {
  outcome: CampaignDeliveryOutcome;
  via: string | null;
  error: string | null;
}

/**
 * Works out how one person would be reached — the same rules the run uses,
 * so the count the admin sees before sending matches what happens.
 *
 * PUSH: app push when they have a mobile token and FCM is configured, web
 * push when they have a browser subscription and VAPID is configured, the
 * Telegram bot when neither applies but they have a chat with it.
 */
export function reachOf(user: AudienceUser, channel: CampaignChannel, transports: Transports): Reach {
  if (!user.notifyPromotions) return { kind: 'opted_out' };
  const tokens = user.devices.filter((d) => Boolean(d.pushToken));
  const telegram = Boolean(user.telegramUserId) && transports.telegram;

  if (channel === 'EMAIL') {
    return user.email
      ? { kind: 'reachable', appPush: false, webPush: false, telegram: false, email: true }
      : { kind: 'no_channel' };
  }
  if (channel === 'TELEGRAM') {
    return telegram
      ? { kind: 'reachable', appPush: false, webPush: false, telegram: true, email: false }
      : { kind: 'no_channel' };
  }
  const appPush = transports.fcm && tokens.some((d) => d.type === 'IOS' || d.type === 'ANDROID');
  const webPush = transports.webpush && tokens.some((d) => d.type === 'WEB');
  if (appPush || webPush) return { kind: 'reachable', appPush, webPush, telegram: false, email: false };
  if (telegram) return { kind: 'reachable', appPush: false, webPush: false, telegram: true, email: false };
  return { kind: 'no_channel' };
}

/**
 * The people an audience means, for one brand. Staff accounts and blocked
 * users are never included.
 *
 * - ALL — anyone with a tie to the brand: an order at one of its stores in
 *   any status (an abandoned or expired checkout still means they opened
 *   this brand's menu and chose something), a cart at one of its stores,
 *   or a gift card of the brand they bought. There is no per-brand bot or
 *   app (one platform bot, one app), so sign-in says nothing about a brand.
 * - HAS_ORDERED — at least one paid order at the brand.
 * - INACTIVE_30D — paid before, but not in the last 30 days.
 */
export function audienceWhere(brandId: string, audience: CampaignAudience, now = new Date()): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { role: 'CUSTOMER', blockedAt: null };
  const paidHere: Prisma.OrderWhereInput = { store: { brandId }, status: { in: PAID_STATUSES } };

  if (audience === 'HAS_ORDERED') return { ...base, orders: { some: paidHere } };
  if (audience === 'INACTIVE_30D') {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    return { ...base, orders: { some: paidHere, none: { ...paidHere, createdAt: { gt: cutoff } } } };
  }
  return {
    ...base,
    OR: [
      { orders: { some: { store: { brandId } } } },
      { carts: { some: { store: { brandId } } } },
      { giftCardsPurchased: { some: { brandId } } },
    ],
  };
}

/** Whether "send" may start a run for a campaign in this state. */
export function isSendable(c: Pick<Campaign, 'status' | 'failedCount' | 'updatedAt'>, now = Date.now()): boolean {
  if (c.status === 'DRAFT' || c.status === 'FAILED') return true;
  // A finished run with failures: retry reaches only the ones it missed.
  if (c.status === 'SENT') return c.failedCount > 0;
  if (c.status === 'SENDING') return now - c.updatedAt.getTime() > STALE_SENDING_MS;
  return false;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  list(brandId: string): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  create(input: {
    brandId: string;
    title: string;
    body: string;
    channel: CampaignChannel;
    audience: CampaignAudience;
  }): Promise<Campaign> {
    return this.prisma.campaign.create({
      data: {
        brandId: input.brandId,
        title: input.title,
        body: input.body,
        channel: input.channel,
        audience: input.audience,
        status: 'DRAFT',
      },
    });
  }

  async deleteDraft(brandId: string, id: string): Promise<void> {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.brandId !== brandId) throw new NotFoundException('Campaign not found');
    if (c.status !== 'DRAFT') throw new BadRequestException('Only DRAFT campaigns can be deleted');
    await this.prisma.campaign.delete({ where: { id } });
  }

  transports(): Transports {
    return { ...this.notifications.transportStatus(), email: this.mail.isConfigured() };
  }

  /** How many people a campaign would reach, and through what — shown before sending. */
  async preview(brandId: string, audience: CampaignAudience, channel: CampaignChannel): Promise<CampaignPreview> {
    const users = await this.prisma.user.findMany({
      where: audienceWhere(brandId, audience),
      select: AUDIENCE_USER_SELECT,
    });
    const transports = this.transports();
    const preview: CampaignPreview = {
      total: users.length,
      reachable: 0,
      optedOut: 0,
      noChannel: 0,
      byChannel: { appPush: 0, webPush: 0, telegram: 0, email: 0 },
      transports,
    };
    for (const user of users) {
      const reach = reachOf(user, channel, transports);
      if (reach.kind === 'opted_out') preview.optedOut++;
      else if (reach.kind === 'no_channel') preview.noChannel++;
      else {
        preview.reachable++;
        if (reach.appPush) preview.byChannel.appPush++;
        if (reach.webPush) preview.byChannel.webPush++;
        if (reach.telegram) preview.byChannel.telegram++;
        if (reach.email) preview.byChannel.email++;
      }
    }
    return preview;
  }

  /**
   * Starts (or retries) a campaign and returns at once with the row in
   * SENDING; the fan-out runs in the background and refreshes the counters
   * after every batch. A retry skips everyone who already received it.
   */
  async send(brandId: string, id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign || campaign.brandId !== brandId) throw new NotFoundException('Campaign not found');
    if (!isSendable(campaign)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: campaign.status === 'SENDING' ? 'CAMPAIGN_IN_PROGRESS' : 'CAMPAIGN_NOT_SENDABLE',
        message: `Cannot send a campaign in status ${campaign.status}`,
      });
    }

    const audienceSize = await this.prisma.user.count({ where: audienceWhere(brandId, campaign.audience) });
    if (audienceSize === 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'CAMPAIGN_NO_RECIPIENTS',
        message: 'Nobody matches this audience yet',
      });
    }

    // Claim the row: only one run per campaign, even with two clicks.
    const claimed = await this.prisma.campaign.updateMany({
      where: { id, status: campaign.status, updatedAt: campaign.updatedAt },
      data: { status: 'SENDING', startedAt: new Date(), lastError: null, targetCount: audienceSize },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'CAMPAIGN_IN_PROGRESS',
        message: 'The campaign is already being sent',
      });
    }

    void this.run(id);
    return this.prisma.campaign.findUniqueOrThrow({ where: { id } });
  }

  /**
   * The background run. Never throws: anything unexpected marks the
   * campaign FAILED with the reason, so the admin sees it and can retry.
   */
  async run(id: string): Promise<void> {
    try {
      const campaign = await this.prisma.campaign.findUniqueOrThrow({ where: { id } });
      const done = await this.prisma.campaignDelivery.findMany({
        where: { campaignId: id, outcome: 'SENT' },
        select: { userId: true },
      });
      const alreadySent = new Set(done.map((d) => d.userId));
      const audience = await this.prisma.user.findMany({
        where: audienceWhere(campaign.brandId, campaign.audience),
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      const target = new Set([...audience.map((u) => u.id), ...alreadySent]).size;
      const pending = audience.map((u) => u.id).filter((uid) => !alreadySent.has(uid));
      this.logger.log(
        `Campaign ${id}: ${pending.length} to deliver (${alreadySent.size} already received it), channel ${campaign.channel}`,
      );

      let lastError: string | null = null;
      for (let i = 0; i < pending.length; i += SEND_BATCH_SIZE) {
        const ids = pending.slice(i, i + SEND_BATCH_SIZE);
        const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: AUDIENCE_USER_SELECT });
        const records = await Promise.all(users.map((u) => this.deliverOne(u, campaign)));
        await this.prisma.$transaction(
          users.map((u, j) => {
            const r = records[j] as DeliveryRecord;
            return this.prisma.campaignDelivery.upsert({
              where: { campaignId_userId: { campaignId: id, userId: u.id } },
              create: { campaignId: id, userId: u.id, ...r },
              update: r,
            });
          }),
        );
        for (const r of records) if (r.error) lastError = r.error;
        await this.writeCounters(id, { targetCount: target, lastError });
      }

      const counts = await this.writeCounters(id, { targetCount: target, lastError });
      const ok = counts.sentCount > 0;
      const reason = ok ? lastError : (lastError ?? emptyRunReason(counts));
      await this.prisma.campaign.update({
        where: { id },
        data: { status: ok ? 'SENT' : 'FAILED', sentAt: new Date(), lastError: reason },
      });
      this.logger.log(
        `Campaign ${id} ${ok ? 'SENT' : 'FAILED'}: ${counts.sentCount} sent, ${counts.failedCount} failed, ` +
          `${counts.noChannelCount} unreachable, ${counts.optedOutCount} opted out of ${target}` +
          (reason ? ` — last error: ${reason}` : ''),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Campaign ${id} run crashed: ${message}`, err instanceof Error ? err.stack : undefined);
      await this.prisma.campaign
        .update({ where: { id }, data: { status: 'FAILED', lastError: message.slice(0, 1000) } })
        .catch((e: Error) => this.logger.error(`Could not mark campaign ${id} FAILED: ${e.message}`));
    }
  }

  /**
   * Sends the copy to the admin themselves, through the same channel rules,
   * without touching any campaign. Ignores their own promotions opt-out.
   */
  async sendTest(
    userId: string,
    input: { title: string; body: string; channel: CampaignChannel },
  ): Promise<TestSendResult> {
    if (input.channel === 'EMAIL') {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user?.email) return { outcome: 'no_channel', via: [] };
      if (!this.mail.isConfigured())
        return { outcome: 'failed', via: [], error: 'SMTP_HOST is not set — email is off' };
      await this.mail.send(user.email, input.title, input.body);
      return { outcome: 'sent', via: ['email'] };
    }
    const result = await this.notifications.sendCampaignTo(userId, input.channel, input.title, input.body, {
      ignoreOptOut: true,
    });
    if (result.outcome === 'opted_out') return { outcome: 'no_channel', via: [] };
    return result;
  }

  /**
   * A run that died with the process (deploy, crash) leaves its row in
   * SENDING. Turn such rows into FAILED so the admin sees what happened and
   * can retry — the retry skips the people it already reached.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async failStuck(): Promise<void> {
    const stuck = await this.prisma.campaign.updateMany({
      where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
      data: { status: 'FAILED', lastError: 'Sending stopped without finishing (server restart?). Retry to continue.' },
    });
    if (stuck.count > 0) this.logger.warn(`Marked ${stuck.count} stuck campaign(s) FAILED`);
  }

  private async deliverOne(
    user: AudienceUser,
    campaign: Pick<Campaign, 'channel' | 'title' | 'body'>,
  ): Promise<DeliveryRecord> {
    const record = (outcome: CampaignDeliveryOutcome, via: string[] = [], error?: string): DeliveryRecord => ({
      outcome,
      via: via.length > 0 ? via.join(',') : null,
      error: error ? error.slice(0, 1000) : null,
    });

    if (!user.notifyPromotions) return record('OPTED_OUT');

    if (campaign.channel === 'EMAIL') {
      if (!user.email) return record('NO_CHANNEL');
      if (!this.mail.isConfigured()) return record('FAILED', [], 'SMTP_HOST is not set — email is off');
      await this.mail.send(user.email, campaign.title, campaign.body);
      return record('SENT', ['email']);
    }

    try {
      const result = await this.notifications.deliver(
        toPushRecipient(user),
        { kind: 'generic', title: campaign.title, body: campaign.body },
        campaign.channel === 'TELEGRAM' ? 'telegram' : 'push',
      );
      if (result.outcome === 'sent') return record('SENT', result.via);
      if (result.outcome === 'failed') return record('FAILED', [], result.error);
      return record('NO_CHANNEL');
    } catch (err) {
      return record('FAILED', [], err instanceof Error ? err.message : String(err));
    }
  }

  /** Recounts the outcomes from the delivery rows and stamps them on the campaign. */
  private async writeCounters(
    id: string,
    extra: { targetCount: number; lastError: string | null },
  ): Promise<{ sentCount: number; failedCount: number; noChannelCount: number; optedOutCount: number }> {
    const groups = await this.prisma.campaignDelivery.groupBy({
      by: ['outcome'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const count = (o: CampaignDeliveryOutcome): number => groups.find((g) => g.outcome === o)?._count._all ?? 0;
    const counts = {
      sentCount: count('SENT'),
      failedCount: count('FAILED'),
      noChannelCount: count('NO_CHANNEL'),
      optedOutCount: count('OPTED_OUT'),
    };
    await this.prisma.campaign.update({
      where: { id },
      data: { ...counts, targetCount: extra.targetCount, lastError: extra.lastError },
    });
    return counts;
  }
}

/** Why a run with no failures reached nobody. */
function emptyRunReason(counts: { noChannelCount: number; optedOutCount: number }): string {
  if (counts.noChannelCount > 0) {
    return 'Nobody could be reached: no app or web push token, no Telegram chat with the bot (or email for the email channel)';
  }
  if (counts.optedOutCount > 0) return 'Everyone in the audience has turned promotions off';
  return 'Nobody matches this audience';
}
