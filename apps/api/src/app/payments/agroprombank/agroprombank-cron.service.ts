import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankConfig } from './agroprombank.config';
import { AgroprombankService } from './agroprombank.service';

/** Payments younger than this may still be mid-flight in another request. */
const RECONCILE_AFTER_MS = 2 * 60_000;

@Injectable()
export class AgroprombankCronService {
  private readonly logger = new Logger(AgroprombankCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AgroprombankConfig,
    private readonly agro: AgroprombankService,
  ) {}

  /**
   * Resolves payments whose outcome we never learned.
   *
   * A charge that times out mid-flight is genuinely ambiguous: the customer's
   * card may well have been debited. Guessing either way is wrong — one way
   * hands out free coffee, the other charges for a cancelled order — so the
   * bank is asked instead, on a schedule, until it answers.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'agroprombank-reconcile' })
  async reconcile(): Promise<void> {
    if (!this.config.isConfigured) return;
    try {
      const { checked, settled } = await this.agro.reconcilePendingPayments(RECONCILE_AFTER_MS);
      if (checked > 0) {
        this.logger.log(`Reconciled ${checked} pending payment(s); ${settled} turned out to be settled`);
      }
    } catch (err) {
      this.logger.error(`Reconciliation pass failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Retires binding requests nobody finished. Keeps the table from filling up
   * with abandoned attempts and stops a stale request from being confirmed
   * long after the SMS was sent.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'agroprombank-expire-bindings' })
  async expireStaleBindings(): Promise<void> {
    const { count } = await this.prisma.cardBindingRequest.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', failureReason: 'One-time password expired' },
    });
    if (count > 0) this.logger.log(`Expired ${count} stale card binding request(s)`);
  }
}
