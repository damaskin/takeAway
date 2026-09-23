import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';

import { OpsChatService } from '../notifications/ops-chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ReadinessService } from './readiness.service';

/**
 * How long a paid order may sit without the kitchen accepting it before we
 * treat it as "nobody is watching the board".
 */
const UNACCEPTED_GRACE_MINUTES = 10;
/** The analytics view refreshes every 5 minutes; three misses is a fault. */
const ANALYTICS_STALE_MINUTES = 16;
/**
 * Once an alert fires, stay quiet about the same thing for this long. An
 * outage that pages every minute stops being read after the third message.
 */
const ALERT_COOLDOWN_SECONDS = 30 * 60;

type AlertKey = 'dependency_down' | 'orders_unaccepted' | 'analytics_stale';

/**
 * Watches for the failures nobody would otherwise notice until a customer
 * complains.
 *
 * The system had no alerting at all: a dead Redis, a kitchen tablet nobody
 * logged into, a materialized view that stopped refreshing — each was
 * silent until someone thought to look. These are the three that cost real
 * orders, and they go to a Telegram ops chat because that is where the
 * people who can fix them already are.
 *
 * Every alert is de-duplicated through Redis, so a two-hour outage sends
 * one message and not a hundred and twenty.
 */
@Injectable()
export class OpsAlertsService {
  private readonly logger = new Logger(OpsAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly readiness: ReadinessService,
    private readonly opsChat: OpsChatService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'ops-alerts' })
  async sweep(): Promise<void> {
    if (!this.opsChat.enabled) return; // alerting not configured for this deployment

    await Promise.allSettled([this.checkDependencies(), this.checkUnacceptedOrders(), this.checkAnalyticsFreshness()]);
  }

  /** Postgres or Redis is unreachable — everything else is downstream of this. */
  private async checkDependencies(): Promise<void> {
    const report = await this.readiness.check();
    if (report.ready) {
      await this.clear('dependency_down');
      return;
    }

    const down = Object.entries(report.checks)
      .filter(([, c]) => c.status === 'down')
      .map(([name, c]) => `${name} (${c.error ?? 'no detail'})`)
      .join(', ');
    await this.fire('dependency_down', `🚨 API dependency down: ${down}`);
  }

  /**
   * Paid orders the kitchen has not picked up. Usually means the KDS tablet
   * is asleep, logged out, or nobody is on shift — the customer is standing
   * there with a countdown that will not be met.
   */
  private async checkUnacceptedOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - UNACCEPTED_GRACE_MINUTES * 60_000);
    const stuck = await this.prisma.order.groupBy({
      by: ['storeId'],
      where: { status: OrderStatus.PAID, createdAt: { lt: cutoff } },
      _count: { _all: true },
    });

    if (stuck.length === 0) {
      await this.clear('orders_unaccepted');
      return;
    }

    const summary = stuck.map((row) => `${row.storeId}: ${row._count._all}`).join(', ');
    await this.fire(
      'orders_unaccepted',
      `⚠️ Paid orders unaccepted for over ${UNACCEPTED_GRACE_MINUTES} min — ${summary}. Check the KDS tablet.`,
    );
  }

  /**
   * The analytics view stopped refreshing. Silent by nature: the dashboard
   * keeps rendering, it just quietly shows yesterday.
   */
  private async checkAnalyticsFreshness(): Promise<void> {
    let lastRefresh: Date | null = null;
    try {
      const rows = await this.prisma.$queryRaw<{ refreshed_at: Date | null }[]>`
        SELECT MAX("day")::timestamptz AS refreshed_at FROM "mv_orders_daily"
      `;
      lastRefresh = rows[0]?.refreshed_at ?? null;
    } catch (err) {
      // The view is missing entirely — that is worth saying out loud.
      await this.fire('analytics_stale', `⚠️ Analytics view unreadable: ${(err as Error).message}`);
      return;
    }

    // An empty view is fine on a fresh install; only staleness is a fault.
    if (!lastRefresh) {
      await this.clear('analytics_stale');
      return;
    }

    const ageMinutes = (Date.now() - lastRefresh.getTime()) / 60_000;
    // `day` is a calendar date, so it lags by up to a day by construction.
    // What we are really testing is whether today's roll-up ever appeared.
    const staleBy = ageMinutes - 24 * 60;
    if (staleBy > ANALYTICS_STALE_MINUTES) {
      await this.fire(
        'analytics_stale',
        `⚠️ Analytics roll-up has not advanced for ${Math.round(staleBy)} min past the expected window.`,
      );
      return;
    }
    await this.clear('analytics_stale');
  }

  /** Send once, then hold this alert key quiet for the cooldown. */
  private async fire(key: AlertKey, text: string): Promise<void> {
    const redisKey = `ops:alert:${key}`;
    const alreadySent = await this.redis.get(redisKey).catch(() => null);
    if (alreadySent) return;

    this.logger.warn(text);
    const delivered = await this.opsChat.send(text);
    if (delivered) {
      await this.redis.set(redisKey, '1', ALERT_COOLDOWN_SECONDS).catch(() => undefined);
    }
  }

  /** Condition resolved — drop the mute so a recurrence alerts again. */
  private async clear(key: AlertKey): Promise<void> {
    await this.redis.del(`ops:alert:${key}`).catch(() => undefined);
  }
}
