import { Injectable, Logger } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankClient } from './agroprombank.client';
import { AgroprombankConfig } from './agroprombank.config';

/**
 * Releasing a hold, and nothing else.
 *
 * Lives apart from {@link AgroprombankService} because the orders module has
 * to reach it — a cancelled order must not keep the customer's money frozen —
 * and `AgroprombankService` pulls in the settlement pipeline, which itself
 * depends on `OrdersService`. Importing that back into the orders module would
 * close a DI cycle; this service depends on nothing but Prisma and the bank
 * client, so both sides can hold it.
 */
@Injectable()
export class PaymentHoldsService {
  private readonly logger = new Logger(PaymentHoldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AgroprombankConfig,
    private readonly client: AgroprombankClient,
  ) {}

  /**
   * The authorization still waiting on this order, if any. A preauthorized
   * charge is parked in `REQUIRES_ACTION` until it is captured or released —
   * see `AgroprombankService.applyPaymentResponse`.
   */
  findHold(orderId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { orderId, provider: 'AGROPROMBANK', status: 'REQUIRES_ACTION' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Gives the held money back when the order will never be fulfilled — the
   * customer cancelled, or the store turned it down.
   *
   * Best-effort on purpose: the cancellation itself has already been committed
   * by the time we get here, and a bank that is down must not turn a cancelled
   * order into a 500. An uncleared hold expires on the bank side anyway, and
   * the reconciliation cron picks the payment up on the next pass.
   */
  async releaseForOrder(orderId: string, reason: string): Promise<Payment | null> {
    if (!this.config.isConfigured) return null;

    const hold = await this.findHold(orderId);
    if (!hold) return null;

    try {
      await this.client.invoke('ReverseOperation', {
        invoiceid: hold.invoiceId,
        amount: hold.amountCents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not release the hold on order=${orderId} payment=${hold.id}: ${message}`);
      return null;
    }

    const updated = await this.prisma.payment.update({
      where: { id: hold.id },
      data: { status: 'REFUNDED', refundedCents: hold.amountCents },
    });
    await this.prisma.orderEvent.create({
      data: {
        orderId,
        type: 'REFUND_ISSUED',
        payload: {
          provider: 'AGROPROMBANK',
          invoiceId: hold.invoiceId,
          amount: hold.amountCents,
          kind: 'hold-released',
          reason,
        } satisfies Prisma.InputJsonValue,
      },
    });
    this.logger.log(`Released the hold on order=${orderId} (${reason})`);
    return updated;
  }
}
