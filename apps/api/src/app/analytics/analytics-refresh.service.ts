import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Periodically refreshes analytics materialized views. Today there is one —
 * `mv_orders_daily` — which powers /admin/analytics/{summary, revenue,
 * stores}.
 *
 * REFRESH MATERIALIZED VIEW CONCURRENTLY needs an exclusive lock only on
 * the new copy and not on readers, so the admin dashboard never waits. The
 * tradeoff is that two concurrent refreshes serialise — we guard against
 * that with the `running` flag, since BullMQ-style queueing would be
 * overkill for one job.
 */
@Injectable()
export class AnalyticsRefreshService {
  private readonly logger = new Logger(AnalyticsRefreshService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'analytics-mv-refresh' })
  async tick(): Promise<void> {
    await this.refreshOrdersDaily();
  }

  /**
   * Public so other code (admin "Refresh now" buttons, e2e tests) can drive
   * a fresh roll-up without waiting for the cron.
   */
  async refreshOrdersDaily(): Promise<void> {
    if (this.running) {
      this.logger.debug('mv_orders_daily refresh already in progress, skipping');
      return;
    }
    this.running = true;
    const startedAt = Date.now();
    try {
      // Identifier is hard-coded — never templated from user input.
      await this.prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_orders_daily"');
      const ms = Date.now() - startedAt;
      this.logger.log(`mv_orders_daily refreshed in ${ms}ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`mv_orders_daily refresh failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
