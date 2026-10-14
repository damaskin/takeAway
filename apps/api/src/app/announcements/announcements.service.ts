import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Announcement, CampaignDeliveryOutcome, Prisma } from '@prisma/client';
import type { PushTransport } from '@takeaway/shared-types';

import { type AudienceUser, reachOf, STALE_SENDING_MS } from '../campaigns/campaigns.service';
import { codedConflict } from '../common/http/coded-conflict';
import { InboxService } from '../inbox/inbox.service';
import {
  NotificationsService,
  PUSH_RECIPIENT_SELECT,
  toPushRecipient,
  type TransportStatus,
} from '../notifications/notifications.service';
import { PLATFORM_SENDER_NAME, titleWithSender } from '../notifications/push-copy';
import { PrismaService } from '../prisma/prisma.service';

const SEND_BATCH_SIZE = 50;

const MAX_LISTED = 50;
const MAX_LISTED_ERRORS = 3;

/** Every customer who allows promotional notifications — an announcement's audience, always. */
export const ANNOUNCEMENT_AUDIENCE: Prisma.UserWhereInput = {
  role: 'CUSTOMER',
  blockedAt: null,
  notifyPromotions: true,
};

/** Every customer account, for the preview's "out of how many". */
const ALL_CUSTOMERS: Prisma.UserWhereInput = { role: 'CUSTOMER', blockedAt: null };

/** What a run or a preview needs to know about one recipient (the campaigns' shape, so `reachOf` applies). */
const RECIPIENT_SELECT = { ...PUSH_RECIPIENT_SELECT, email: true, notifyPromotions: true } as const;

/** Why an announcement action was refused, as the `code` of the 409 / 400 — the admin translates these. */
export const AnnouncementError = {
  NOT_EDITABLE: 'ANNOUNCEMENT_NOT_EDITABLE',
  NOT_SENDABLE: 'ANNOUNCEMENT_NOT_SENDABLE',
  IN_PROGRESS: 'ANNOUNCEMENT_IN_PROGRESS',
  NOT_SCHEDULED: 'ANNOUNCEMENT_NOT_SCHEDULED',
  NOT_DELETABLE: 'ANNOUNCEMENT_NOT_DELETABLE',
  SCHEDULED_IN_PAST: 'ANNOUNCEMENT_SCHEDULED_IN_PAST',
  NO_RECIPIENTS: 'ANNOUNCEMENT_NO_RECIPIENTS',
  LINK_INVALID: 'ANNOUNCEMENT_LINK_INVALID',
} as const;

/** What the platform admin composes. At most one of the two links. */
export interface AnnouncementInput {
  title: string;
  body: string;
  linkStoreId: string | null;
  linkBrandId: string | null;
  /** Null: «Отправить» sends at once. */
  scheduledAt: Date | null;
}

/** The store or brand a tap opens, by name — what the list shows. */
export interface AnnouncementLink {
  kind: 'STORE' | 'BRAND';
  id: string;
  name: string;
  /** STORE: whose store it is. */
  brandName: string | null;
}

/** How the pushes of one announcement went: transports used and top errors. */
export interface AnnouncementStats {
  via: Record<PushTransport, number>;
  errors: Array<{ error: string; count: number }>;
}

export function emptyAnnouncementStats(): AnnouncementStats {
  return { via: { apns: 0, fcm: 0, webpush: 0, telegram: 0 }, errors: [] };
}

export interface AnnouncementPreview {
  /** Every customer account. */
  customers: number;
  /** Of those, the ones who turned promotions off — they get nothing. */
  optedOut: number;
  /** Everyone else: each gets the message in «Уведомления». */
  recipients: number;
  /** Of the recipients, the ones a push reaches too. */
  pushReachable: number;
  /** Recipients no push reaches — they only find it in «Уведомления». */
  noChannel: number;
  byChannel: { appPush: number; webPush: number; telegram: number };
  transports: TransportStatus;
}

export interface AnnouncementTestResult {
  outcome: 'sent' | 'failed' | 'no_channel';
  via: PushTransport[];
  error?: string;
}

interface DeliveryRecord {
  outcome: CampaignDeliveryOutcome;
  via: string | null;
  error: string | null;
}

/** The copy can change: never sent nor scheduled. */
export function isEditable(a: Pick<Announcement, 'status'>): boolean {
  return a.status === 'DRAFT';
}

/** Nothing has gone out yet. */
export function isDeletable(a: Pick<Announcement, 'status'>): boolean {
  return a.status === 'DRAFT' || a.status === 'SCHEDULED';
}

/**
 * Whether «Повторить» may restart a run: a failed run, a finished one with
 * failed pushes, or one stuck in SENDING. A retry pushes only to the people
 * it missed; nobody gets a second inbox item.
 */
export function isRetryable(a: Pick<Announcement, 'status' | 'failedCount' | 'updatedAt'>, now = Date.now()): boolean {
  if (a.status === 'FAILED') return true;
  if (a.status === 'SENT') return a.failedCount > 0;
  if (a.status === 'SENDING') return now - a.updatedAt.getTime() > STALE_SENDING_MS;
  return false;
}

/**
 * Platform announcements — takeAway writing to its customers itself, e.g.
 * about a new partner. SUPER_ADMIN only and without moderation, so a model
 * of its own rather than a Campaign without a brand: campaigns' brand
 * scoping, plan gate and review queue stay exactly as they are. The
 * delivery machinery is the campaigns' — the same reach rules, the same
 * `NotificationsService.deliver` (app → web → Telegram), batches of 50 in
 * the background with counters after each, a cron for the scheduled ones
 * and for runs a restart left in SENDING.
 *
 * Every recipient gets an item in «Уведомления» before their push goes, so
 * the push can carry the item's id; whoever no push reaches still finds it
 * there.
 */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly inbox: InboxService,
  ) {}

  list(): Promise<Announcement[]> {
    return this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: MAX_LISTED });
  }

  async get(id: string): Promise<Announcement> {
    const row = await this.prisma.announcement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Announcement not found');
    return row;
  }

  create(input: AnnouncementInput & { createdById: string }): Promise<Announcement> {
    return this.prisma.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        linkStoreId: input.linkStoreId,
        linkBrandId: input.linkBrandId,
        scheduledAt: input.scheduledAt,
        createdById: input.createdById,
        status: 'DRAFT',
      },
    });
  }

  /** Changes a draft; conditional on the status, so a send in between is never changed under it. */
  async update(id: string, patch: Partial<AnnouncementInput>): Promise<Announcement> {
    const { count } = await this.prisma.announcement.updateMany({ where: { id, status: 'DRAFT' }, data: patch });
    if (count === 0) {
      await this.get(id);
      throw codedConflict(AnnouncementError.NOT_EDITABLE, 'Only a draft can be changed');
    }
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const { count } = await this.prisma.announcement.deleteMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED'] } },
    });
    if (count === 0) {
      await this.get(id);
      throw codedConflict(
        AnnouncementError.NOT_DELETABLE,
        'An announcement that has started sending cannot be deleted',
      );
    }
  }

  /**
   * Checks the link: an existing store or brand, not both. Returns the pair
   * to store — a store link never carries a brand id along.
   */
  async validateLink(
    linkStoreId: string | null | undefined,
    linkBrandId: string | null | undefined,
  ): Promise<{ linkStoreId: string | null; linkBrandId: string | null }> {
    const storeId = linkStoreId || null;
    const brandId = linkBrandId || null;
    if (storeId && brandId) throw linkInvalid('Link a store or a brand, not both');
    if (storeId && !(await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true } }))) {
      throw linkInvalid('Store not found');
    }
    if (brandId && !(await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } }))) {
      throw linkInvalid('Brand not found');
    }
    return { linkStoreId: storeId, linkBrandId: brandId };
  }

  /** The linked stores and brands of these announcements, by name. */
  async links(
    rows: Array<Pick<Announcement, 'id' | 'linkStoreId' | 'linkBrandId'>>,
  ): Promise<Map<string, AnnouncementLink>> {
    const storeIds = [...new Set(rows.map((r) => r.linkStoreId).filter((id): id is string => Boolean(id)))];
    const brandIds = [...new Set(rows.map((r) => r.linkBrandId).filter((id): id is string => Boolean(id)))];
    const [stores, brands] = await Promise.all([
      storeIds.length > 0
        ? this.prisma.store.findMany({
            where: { id: { in: storeIds } },
            select: { id: true, name: true, brand: { select: { name: true } } },
          })
        : [],
      brandIds.length > 0
        ? this.prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const out = new Map<string, AnnouncementLink>();
    for (const row of rows) {
      const store = row.linkStoreId ? stores.find((s) => s.id === row.linkStoreId) : undefined;
      const brand = row.linkBrandId ? brands.find((b) => b.id === row.linkBrandId) : undefined;
      if (store) out.set(row.id, { kind: 'STORE', id: store.id, name: store.name, brandName: store.brand.name });
      else if (brand) out.set(row.id, { kind: 'BRAND', id: brand.id, name: brand.name, brandName: null });
    }
    return out;
  }

  /** Who composed each announcement. */
  async creators(
    rows: Array<Pick<Announcement, 'id' | 'createdById'>>,
  ): Promise<Map<string, { id: string; name: string | null; email: string | null }>> {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    const out = new Map<string, { id: string; name: string | null; email: string | null }>();
    for (const row of rows) {
      const person = people.find((p) => p.id === row.createdById);
      if (person) out.set(row.id, person);
    }
    return out;
  }

  /** How each announcement's pushes went, from the per-recipient rows. */
  async stats(ids: string[]): Promise<Map<string, AnnouncementStats>> {
    const out = new Map<string, AnnouncementStats>(ids.map((id) => [id, emptyAnnouncementStats()]));
    if (ids.length === 0) return out;
    const [byVia, byError] = await Promise.all([
      this.prisma.announcementDelivery.groupBy({
        by: ['announcementId', 'via'],
        where: { announcementId: { in: ids }, outcome: 'SENT' },
        _count: { _all: true },
      }),
      this.prisma.announcementDelivery.groupBy({
        by: ['announcementId', 'error'],
        where: { announcementId: { in: ids }, error: { not: null } },
        _count: { _all: true },
      }),
    ]);
    for (const row of byVia) {
      const stats = out.get(row.announcementId);
      if (!stats || !row.via) continue;
      for (const v of row.via.split(',')) {
        if (v in stats.via) stats.via[v as PushTransport] += row._count._all;
      }
    }
    for (const row of byError) {
      const stats = out.get(row.announcementId);
      if (stats && row.error) stats.errors.push({ error: row.error, count: row._count._all });
    }
    for (const stats of out.values()) {
      stats.errors = stats.errors.sort((a, b) => b.count - a.count).slice(0, MAX_LISTED_ERRORS);
    }
    return out;
  }

  /** Who an announcement reaches right now, and through what — shown before sending. */
  async preview(): Promise<AnnouncementPreview> {
    const [customers, users] = await Promise.all([
      this.prisma.user.count({ where: ALL_CUSTOMERS }),
      this.prisma.user.findMany({ where: ANNOUNCEMENT_AUDIENCE, select: RECIPIENT_SELECT }),
    ]);
    const transports = this.notifications.transportStatus();
    const preview: AnnouncementPreview = {
      customers,
      optedOut: Math.max(0, customers - users.length),
      recipients: users.length,
      pushReachable: 0,
      noChannel: 0,
      byChannel: { appPush: 0, webPush: 0, telegram: 0 },
      transports,
    };
    for (const user of users) {
      const reach = reachOf(user, 'PUSH', { ...transports, email: false });
      if (reach.kind !== 'reachable') {
        preview.noChannel++;
        continue;
      }
      preview.pushReachable++;
      if (reach.appPush) preview.byChannel.appPush++;
      if (reach.webPush) preview.byChannel.webPush++;
      if (reach.telegram) preview.byChannel.telegram++;
    }
    return preview;
  }

  /**
   * «Отправить себе»: the copy to the signed-in admin only, titled and
   * linked like the real thing, whatever their own promotions setting. No
   * inbox item — the test is not an announcement.
   */
  async sendTest(
    userId: string,
    input: { title: string; body: string; linkStoreId: string | null; linkBrandId: string | null },
  ): Promise<AnnouncementTestResult> {
    const result = await this.notifications.sendCampaignTo(
      userId,
      'PUSH',
      titleWithSender(PLATFORM_SENDER_NAME, input.title),
      input.body,
      {
        ignoreOptOut: true,
        push: {
          kind: 'announcement',
          ...(input.linkStoreId ? { storeId: input.linkStoreId } : {}),
          ...(input.linkBrandId ? { brandId: input.linkBrandId } : {}),
        },
      },
    );
    if (result.outcome === 'opted_out') return { outcome: 'no_channel', via: [] };
    return result;
  }

  /**
   * «Отправить»: a draft goes out now — or, with a time set, waits for it
   * (SCHEDULED) — and «Повторить» restarts a failed or stuck run, or pushes
   * to the people a finished run missed. Answers at once; the run is in the
   * background.
   */
  async send(id: string, now = new Date()): Promise<Announcement> {
    const row = await this.get(id);
    if (row.status === 'DRAFT') {
      if (row.scheduledAt && row.scheduledAt <= now) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: AnnouncementError.SCHEDULED_IN_PAST,
          message: 'The scheduled time has passed',
        });
      }
      const audience = await this.audienceSize();
      if (audience === 0) throw noRecipients();
      if (row.scheduledAt) {
        const { count } = await this.prisma.announcement.updateMany({
          where: { id, status: 'DRAFT', updatedAt: row.updatedAt },
          data: { status: 'SCHEDULED', lastError: null },
        });
        if (count === 0) throw inProgress();
        return this.get(id);
      }
      if (!(await this.claim(row, audience))) throw inProgress();
      void this.run(id);
      return this.get(id);
    }

    if (!isRetryable(row)) {
      throw codedConflict(
        row.status === 'SENDING' ? AnnouncementError.IN_PROGRESS : AnnouncementError.NOT_SENDABLE,
        `Cannot send an announcement in status ${row.status}`,
      );
    }
    const audience = await this.audienceSize();
    if (audience === 0) throw noRecipients();
    if (!(await this.claim(row, audience))) throw inProgress();
    void this.run(id);
    return this.get(id);
  }

  /** «Отменить отправку»: a scheduled announcement goes back to a draft. */
  async cancel(id: string): Promise<Announcement> {
    const { count } = await this.prisma.announcement.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: { status: 'DRAFT' },
    });
    if (count === 0) {
      await this.get(id);
      throw codedConflict(AnnouncementError.NOT_SCHEDULED, 'The announcement is not scheduled');
    }
    return this.get(id);
  }

  audienceSize(): Promise<number> {
    return this.prisma.user.count({ where: ANNOUNCEMENT_AUDIENCE });
  }

  /** Scheduled announcements whose time has come. */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDue(now = new Date()): Promise<void> {
    const due = await this.prisma.announcement.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });
    for (const row of due) {
      try {
        const audience = await this.audienceSize();
        if (audience === 0) {
          await this.prisma.announcement.updateMany({
            where: { id: row.id, status: 'SCHEDULED', updatedAt: row.updatedAt },
            data: { status: 'FAILED', lastError: EMPTY_AUDIENCE },
          });
          continue;
        }
        if (await this.claim(row, audience)) void this.run(row.id);
      } catch (err) {
        this.logger.error(
          `Could not start announcement ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * A run that died with the process (deploy, crash) leaves its row in
   * SENDING. Turn such rows into FAILED so the admin sees it and can retry
   * — the retry skips the people it already reached.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async failStuck(): Promise<void> {
    const stuck = await this.prisma.announcement.updateMany({
      where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
      data: { status: 'FAILED', lastError: 'Sending stopped without finishing (server restart?). Retry to continue.' },
    });
    if (stuck.count > 0) this.logger.warn(`Marked ${stuck.count} stuck announcement(s) FAILED`);
  }

  /** Claims the row for one run — one run at a time, even with two clicks or a click racing the scheduler. */
  private async claim(row: Announcement, audienceSize: number): Promise<boolean> {
    const { count } = await this.prisma.announcement.updateMany({
      where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
      data: { status: 'SENDING', startedAt: new Date(), lastError: null, targetCount: audienceSize },
    });
    return count > 0;
  }

  /**
   * The background run. Never throws: anything unexpected marks the row
   * FAILED with the reason. Ends SENT once everyone has the inbox item —
   * even when no push landed, since «Уведомления» is where they read it;
   * the counters say how the pushes went.
   */
  async run(id: string): Promise<void> {
    try {
      const row = await this.prisma.announcement.findUniqueOrThrow({ where: { id } });
      const done = await this.prisma.announcementDelivery.findMany({
        where: { announcementId: id, outcome: 'SENT' },
        select: { userId: true },
      });
      const alreadySent = new Set(done.map((d) => d.userId));
      const audience = await this.prisma.user.findMany({
        where: ANNOUNCEMENT_AUDIENCE,
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      const target = new Set([...audience.map((u) => u.id), ...alreadySent]).size;
      const pending = audience.map((u) => u.id).filter((uid) => !alreadySent.has(uid));
      this.logger.log(`Announcement ${id}: ${pending.length} to deliver (${alreadySent.size} already pushed)`);

      const title = titleWithSender(PLATFORM_SENDER_NAME, row.title);
      let lastError: string | null = null;
      for (let i = 0; i < pending.length; i += SEND_BATCH_SIZE) {
        const ids = pending.slice(i, i + SEND_BATCH_SIZE);
        // Someone who turned promotions off since the start is left out.
        const users = await this.prisma.user.findMany({
          where: { id: { in: ids }, ...ANNOUNCEMENT_AUDIENCE },
          select: RECIPIENT_SELECT,
        });
        const inboxIds = await this.inbox.writeForAnnouncement(
          row,
          users.map((u) => u.id),
        );
        const records = await Promise.all(users.map((u) => this.deliverOne(u, row, title, inboxIds.get(u.id))));
        await this.prisma.$transaction(
          users.map((u, j) => {
            const r = records[j] as DeliveryRecord;
            return this.prisma.announcementDelivery.upsert({
              where: { announcementId_userId: { announcementId: id, userId: u.id } },
              create: { announcementId: id, userId: u.id, ...r },
              update: r,
            });
          }),
        );
        for (const r of records) if (r.error) lastError = r.error;
        await this.writeCounters(id, { targetCount: target, lastError });
      }

      const counts = await this.writeCounters(id, { targetCount: target, lastError });
      const ok = target > 0;
      await this.prisma.announcement.update({
        where: { id },
        data: { status: ok ? 'SENT' : 'FAILED', sentAt: new Date(), lastError: ok ? lastError : EMPTY_AUDIENCE },
      });
      this.logger.log(
        `Announcement ${id} ${ok ? 'SENT' : 'FAILED'}: ${counts.sentCount} pushed, ${counts.failedCount} failed, ` +
          `${counts.noChannelCount} inbox only, of ${target}` +
          (lastError ? ` — last error: ${lastError}` : ''),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Announcement ${id} run crashed: ${message}`, err instanceof Error ? err.stack : undefined);
      await this.prisma.announcement
        .update({ where: { id }, data: { status: 'FAILED', lastError: message.slice(0, 1000) } })
        .catch((e: Error) => this.logger.error(`Could not mark announcement ${id} FAILED: ${e.message}`));
    }
  }

  private async deliverOne(
    user: AudienceUser,
    row: Pick<Announcement, 'body' | 'linkStoreId' | 'linkBrandId'>,
    title: string,
    notificationId: string | undefined,
  ): Promise<DeliveryRecord> {
    const record = (outcome: CampaignDeliveryOutcome, via: string[] = [], error?: string): DeliveryRecord => ({
      outcome,
      via: via.length > 0 ? via.join(',') : null,
      error: error ? error.slice(0, 1000) : null,
    });
    try {
      const result = await this.notifications.deliver(toPushRecipient(user), {
        kind: 'announcement',
        title,
        body: row.body,
        ...(notificationId ? { notificationId } : {}),
        ...(row.linkStoreId ? { storeId: row.linkStoreId } : {}),
        ...(row.linkBrandId ? { brandId: row.linkBrandId } : {}),
      });
      if (result.outcome === 'sent') return record('SENT', result.via, result.error);
      if (result.outcome === 'failed') return record('FAILED', [], result.error);
      return record('NO_CHANNEL');
    } catch (err) {
      return record('FAILED', [], err instanceof Error ? err.message : String(err));
    }
  }

  /** Recounts the outcomes from the delivery rows and stamps them on the row. */
  private async writeCounters(
    id: string,
    extra: { targetCount: number; lastError: string | null },
  ): Promise<{ sentCount: number; failedCount: number; noChannelCount: number }> {
    const groups = await this.prisma.announcementDelivery.groupBy({
      by: ['outcome'],
      where: { announcementId: id },
      _count: { _all: true },
    });
    const count = (o: CampaignDeliveryOutcome): number => groups.find((g) => g.outcome === o)?._count._all ?? 0;
    const counts = { sentCount: count('SENT'), failedCount: count('FAILED'), noChannelCount: count('NO_CHANNEL') };
    await this.prisma.announcement.update({
      where: { id },
      data: { ...counts, targetCount: extra.targetCount, lastError: extra.lastError },
    });
    return counts;
  }
}

const EMPTY_AUDIENCE = 'Nobody allows promotional notifications';

function noRecipients(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: AnnouncementError.NO_RECIPIENTS,
    message: EMPTY_AUDIENCE,
  });
}

function inProgress() {
  return codedConflict(AnnouncementError.IN_PROGRESS, 'The announcement is already being sent');
}

function linkInvalid(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: AnnouncementError.LINK_INVALID,
    message,
  });
}
