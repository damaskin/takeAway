import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankQrConfig } from '../agroprombank-qr/agroprombank-qr.config';
import { AgroprombankQrService } from '../agroprombank-qr/agroprombank-qr.service';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { AgroprombankWebService } from '../agroprombank-web/agroprombank-web.service';
import { AgroprombankConfig } from './agroprombank.config';
import { AgroprombankService } from './agroprombank.service';
import { PaymentHoldsService } from './payment-holds.service';

/** Payments younger than this may still be mid-flight in another request. */
const RECONCILE_AFTER_MS = 2 * 60_000;
/** QR invoices are asked about sooner: the customer is standing there with the bank's app open. */
const QR_RECONCILE_AFTER_MS = 60_000;

@Injectable()
export class AgroprombankCronService {
  private readonly logger = new Logger(AgroprombankCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AgroprombankConfig,
    private readonly agro: AgroprombankService,
    private readonly webConfig: AgroprombankWebConfig,
    private readonly web: AgroprombankWebService,
    private readonly qrConfig: AgroprombankQrConfig,
    private readonly qr: AgroprombankQrService,
    private readonly holds: PaymentHoldsService,
  ) {}

  /**
   * Resolves payments whose outcome we never learned, in every flow.
   *
   * A charge that times out mid-flight is genuinely ambiguous: the customer's
   * card may well have been debited. Guessing either way is wrong — one way
   * hands out free coffee, the other charges for a cancelled order — so the
   * bank is asked instead, on a schedule, until it answers. On the Web-платёж
   * and QR side the same pass catches a notification that never arrived, and
   * closes QR invoices past their lifetime.
   *
   * Then the holds that should have been released and were not: the order was
   * cancelled or expired while the bank was unreachable. QR payments are
   * among them (they are in CARD_PROVIDERS): their release is a reversal.
   * Those run whenever the QR service can be called, switched on for new
   * orders or not.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'agroprombank-reconcile' })
  async reconcile(): Promise<void> {
    if (this.config.isConfigured) {
      await this.pass('bound-card payments', () => this.agro.reconcilePendingPayments(RECONCILE_AFTER_MS));
    }
    if (this.webConfig.isConfigured) {
      await this.pass('Web-платёж invoices', () => this.web.reconcilePendingPayments(RECONCILE_AFTER_MS));
    }
    if (this.qrConfig.canCallBank) {
      await this.pass('QR invoices', () => this.qr.reconcilePendingPayments(QR_RECONCILE_AFTER_MS));
    }
    if (this.config.isConfigured || this.webConfig.isConfigured || this.qrConfig.canCallBank) {
      try {
        const { checked, released } = await this.holds.retryPendingReleases();
        if (checked > 0) this.logger.log(`Retried ${checked} hold release(s); ${released} released`);
      } catch (err) {
        this.logger.error(`Hold release retry failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async pass(label: string, run: () => Promise<{ checked: number; settled: number }>): Promise<void> {
    try {
      const { checked, settled } = await run();
      if (checked > 0) this.logger.log(`Reconciled ${checked} pending ${label}; ${settled} turned out to be paid`);
    } catch (err) {
      this.logger.error(`Reconciliation of ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
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
