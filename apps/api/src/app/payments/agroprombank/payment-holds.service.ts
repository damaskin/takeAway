import { Injectable, Logger } from '@nestjs/common';
import type { Payment, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankWebClient, AgroprombankWebError } from '../agroprombank-web/agroprombank-web.client';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { CARD_PROVIDERS, isDeferredCharge } from '../card-providers';
import { AgroprombankClient } from './agroprombank.client';
import { AgroprombankConfig } from './agroprombank.config';

/** A release the bank keeps refusing is given up on after this many tries. */
export const MAX_RELEASE_ATTEMPTS = 20;

/** Holds younger than this may still be in the hands of the request that cancelled the order. */
const RETRY_RELEASE_AFTER_MS = 2 * 60_000;

/**
 * Releasing a hold, and nothing else.
 *
 * Lives apart from the payment services because the orders module has to
 * reach it — a cancelled order must not keep the customer's money frozen —
 * and those services pull in the settlement pipeline, which itself depends on
 * `OrdersService`. Importing that back into the orders module would close a DI
 * cycle; this service depends on nothing but Prisma and the two bank clients,
 * so both sides can hold it.
 *
 * Provider-aware: a hold taken through the bound-card flow is released with
 * `ReverseOperation`, one taken on the Web-платёж page with `CancelOperation`.
 */
@Injectable()
export class PaymentHoldsService {
  private readonly logger = new Logger(PaymentHoldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AgroprombankConfig,
    private readonly client: AgroprombankClient,
    private readonly webConfig: AgroprombankWebConfig,
    private readonly webClient: AgroprombankWebClient,
  ) {}

  /**
   * The authorization still waiting on this order, if any. A preauthorized
   * charge is parked in `REQUIRES_ACTION` until it is captured or released.
   */
  findHold(orderId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { orderId, provider: { in: [...CARD_PROVIDERS] }, status: 'REQUIRES_ACTION' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Whether an order has to be paid by card before the kitchen may take it.
   *
   * Paying at the counter is gone: with card payments on — either flow — an
   * order that costs anything waits for its hold before it reaches the kitchen
   * board, and the board cannot accept it without one. A zero total (points or
   * a gift card covered it all) has nothing to hold. With card payments
   * switched off on a deployment nothing can be held, so the rule stands down
   * rather than locking every order out.
   */
  cardPaymentRequired(order: { totalCents: number }): boolean {
    return this.webConfig.cardPaymentFlow !== 'none' && order.totalCents > 0;
  }

  /** A hold or a completed card charge is on the order. */
  async hasCardPayment(orderId: string): Promise<boolean> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, provider: { in: [...CARD_PROVIDERS] }, status: { in: ['REQUIRES_ACTION', 'SUCCEEDED'] } },
      select: { id: true },
    });
    return payment !== null;
  }

  /**
   * Gives the held money back when the order will never be fulfilled — the
   * customer cancelled, the store turned it down, or nobody accepted it in time.
   *
   * Best-effort on purpose: the cancellation itself has already been committed
   * by the time we get here, and a bank that is down must not turn a cancelled
   * order into a 500. The hold stays in `REQUIRES_ACTION` and the
   * reconciliation cron retries it ({@link retryPendingReleases}).
   */
  async releaseForOrder(orderId: string, reason: string): Promise<Payment | null> {
    const hold = await this.findHold(orderId);
    if (!hold) return null;
    return this.release(hold, reason);
  }

  /** Releases one hold; `null` when the bank could not be reached or refused. */
  async release(hold: Payment, reason: string): Promise<Payment | null> {
    if (isDeferredCharge(hold)) return this.voidDeferred(hold, reason);
    if (!hold.invoiceId) return null;
    const web = hold.provider === 'AGROPROMBANK_WEB';
    if (web ? !this.webConfig.isConfigured : !this.config.isConfigured) return null;

    try {
      if (web) {
        await this.webClient.cancel(hold.invoiceId);
      } else {
        await this.client.invoke('ReverseOperation', { invoiceid: hold.invoiceId, amount: hold.amountCents });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = releaseAttempts(hold) + 1;
      await this.prisma.payment.update({
        where: { id: hold.id },
        data: { rawJson: { ...rawOf(hold), releaseAttempts: attempts, lastReleaseError: message } },
      });
      // CancelOperation only works within the day of payment. A refusal there
      // is definitive, and a hold the bank will not cancel stays on the card
      // until the bank lets it lapse — ops has to know.
      const level = err instanceof AgroprombankWebError || attempts >= MAX_RELEASE_ATTEMPTS ? 'error' : 'warn';
      this.logger[level](
        `Could not release the hold on order=${hold.orderId} payment=${hold.id} (attempt ${attempts}): ${message}`,
      );
      return null;
    }

    const updated = await this.prisma.payment.update({
      where: { id: hold.id },
      data: { status: 'REFUNDED', refundedCents: hold.amountCents },
    });
    await this.prisma.orderEvent.create({
      data: {
        orderId: hold.orderId,
        type: 'REFUND_ISSUED',
        payload: {
          provider: hold.provider,
          invoiceId: hold.invoiceId,
          amount: hold.amountCents,
          kind: 'hold-released',
          reason,
        } satisfies Prisma.InputJsonValue,
      },
    });
    this.logger.log(`Released the hold on order=${hold.orderId} (${reason})`);
    return updated;
  }

  /**
   * Calls off a charge that was waiting for the accept. Nothing reached the
   * bank, so there is nothing to give back: the row is closed as FAILED and
   * marked `voided`, which the customer's order view reads as "not charged".
   * Claimed conditionally, so an accept that got to it first wins.
   */
  private async voidDeferred(hold: Payment, reason: string): Promise<Payment | null> {
    const voided = await this.prisma.payment.updateMany({
      where: { id: hold.id, status: 'REQUIRES_ACTION', invoiceId: null },
      data: { status: 'FAILED', rawJson: { ...rawOf(hold), voided: true, voidReason: reason } },
    });
    if (voided.count === 0) return null;
    this.logger.log(`Called off the deferred charge on order=${hold.orderId} (${reason}); the card was not charged`);
    return this.prisma.payment.findUnique({ where: { id: hold.id } });
  }

  /**
   * Holds that should have been released and were not: the order is
   * cancelled or expired, or the payment was flagged for release (a second
   * payment for an order already paid for, an amount the bank changed). The
   * release after a cancel is best-effort, so without this pass a bank hiccup
   * at that moment left the customer's money frozen for good.
   */
  async retryPendingReleases(limit = 50): Promise<{ checked: number; released: number }> {
    const cutoff = new Date(Date.now() - RETRY_RELEASE_AFTER_MS);
    const holds = await this.prisma.payment.findMany({
      where: {
        provider: { in: [...CARD_PROVIDERS] },
        status: 'REQUIRES_ACTION',
        updatedAt: { lt: cutoff },
        OR: [
          { order: { status: { in: ['CANCELLED', 'EXPIRED'] } } },
          { rawJson: { path: ['releaseRequired'], equals: true } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });

    let released = 0;
    let checked = 0;
    for (const hold of holds) {
      if (releaseAttempts(hold) >= MAX_RELEASE_ATTEMPTS) continue;
      checked += 1;
      if (await this.release(hold, 'retry')) released += 1;
    }
    return { checked, released };
  }
}

function rawOf(payment: Payment): Record<string, Prisma.InputJsonValue> {
  const raw = payment.rawJson;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Prisma.InputJsonValue>) : {};
}

function releaseAttempts(payment: Payment): number {
  const value = rawOf(payment)['releaseAttempts'];
  return typeof value === 'number' ? value : 0;
}
