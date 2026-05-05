/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PosService } from '../pos/pos.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { STRIPE_CLIENT, StripeConfig } from './stripe.config';

// Minimal runtime-only shape of the Stripe objects we consume. Full types
// come from the stripe package at call sites; we avoid importing them here
// because stripe v22 rearranged its namespace structure in ways that don't
// surface cleanly under strict TS.
type StripeLike = {
  paymentIntents: {
    create: (params: Record<string, any>) => Promise<{ id: string; client_secret: string | null; status: string }>;
    retrieve: (id: string) => Promise<{ id: string; client_secret: string | null; status: string }>;
  };
  refunds: {
    create: (params: {
      payment_intent: string;
      amount?: number;
      reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
      metadata?: Record<string, string>;
    }) => Promise<{ id: string; amount: number; status: string; charge?: string | null }>;
  };
  webhooks: {
    constructEvent: (
      body: Buffer | string,
      signature: string,
      secret: string,
    ) => { type: string; data: { object: any } };
  };
};

export type RefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer';

export interface RefundOptions {
  /** Optional partial amount in cents. Omit to refund the remaining balance. */
  amountCents?: number;
  reason?: RefundReason;
  /** Caller (admin) — recorded on the OrderEvent for audit. */
  actorId: string;
  /** Free-form note from the admin UI. Stored on the event payload. */
  note?: string;
}

export interface RefundResult {
  refundId: string;
  refundedCents: number;
  remainingCents: number;
  paymentStatus: 'REFUNDED' | 'PARTIALLY_REFUNDED';
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: StripeConfig,
    private readonly realtime: RealtimeGateway,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly pos: PosService,
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeLike | null,
  ) {}

  async createPaymentIntent(userId: string, orderId: string): Promise<{ clientSecret: string }> {
    if (!this.stripe) throw new ServiceUnavailableException('Stripe is not configured on this deployment');

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (order.status !== 'CREATED') {
      throw new BadRequestException(`Cannot start payment for order in status ${order.status}`);
    }

    const existing = await this.prisma.payment.findFirst({
      where: { orderId: order.id, status: { in: ['PENDING', 'REQUIRES_ACTION'] } },
    });

    let intent: { id: string; client_secret: string | null; status: string };
    if (existing?.providerRef) {
      intent = await this.stripe.paymentIntents.retrieve(existing.providerRef);
    } else {
      intent = await this.stripe.paymentIntents.create({
        amount: order.totalCents,
        currency: order.currency.toLowerCase(),
        metadata: { orderId: order.id, userId },
        automatic_payment_methods: { enabled: true },
      });
      await this.prisma.payment.create({
        data: {
          orderId: order.id,
          provider: 'STRIPE',
          providerRef: intent.id,
          status: this.toPaymentStatus(intent.status),
          amountCents: order.totalCents,
          currency: order.currency,
          rawJson: intent as unknown as Prisma.InputJsonValue,
        },
      });
      await this.prisma.order.update({ where: { id: order.id }, data: { paymentIntentId: intent.id } });
    }

    if (!intent.client_secret) {
      throw new ServiceUnavailableException('Stripe did not return a client secret');
    }
    return { clientSecret: intent.client_secret };
  }

  /**
   * Issue a refund (full or partial) for a paid order. Called from the admin
   * UI / API when ops decides to give money back. Optimistically updates the
   * `Payment` row in our DB so the admin sees the change immediately; the
   * eventual `charge.refunded` webhook is still consumed by `onRefunded` and
   * acts as a confirmation (idempotent — same providerRef + amount).
   *
   * The order's own `OrderStatus` is NOT touched here on purpose — refund
   * is about money, not lifecycle. If the customer cancelled, the cancel
   * already moved status to `CANCELLED`; if not, the order can still be
   * fulfilled and refunded for goodwill.
   */
  async refundOrder(orderId: string, opts: RefundOptions): Promise<RefundResult> {
    if (!this.stripe) throw new ServiceUnavailableException('Stripe is not configured on this deployment');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Use the most recent successful (or partially-refunded) payment with a
    // Stripe payment_intent reference. Skip everything still PENDING /
    // REQUIRES_ACTION / FAILED — Stripe will reject a refund against those.
    const payment = order.payments.find(
      (p) => p.provider === 'STRIPE' && p.providerRef && (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED'),
    );
    if (!payment) {
      throw new BadRequestException(`Order ${orderId} has no captured Stripe payment to refund`);
    }
    const remaining = payment.amountCents - payment.refundedCents;
    if (remaining <= 0) {
      throw new BadRequestException(`Order ${orderId} is already fully refunded`);
    }

    const amount = opts.amountCents ?? remaining;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Refund amount must be a positive integer (cents)');
    }
    if (amount > remaining) {
      throw new BadRequestException(`Refund amount ${amount} exceeds remaining balance ${remaining}`);
    }

    let stripeRefund: { id: string; amount: number; status: string };
    try {
      stripeRefund = await this.stripe.refunds.create({
        payment_intent: payment.providerRef!,
        amount,
        reason: opts.reason,
        metadata: { orderId, actorId: opts.actorId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown Stripe error';
      this.logger.warn(`Stripe refund failed for order=${orderId}: ${message}`);
      throw new BadRequestException(`Stripe refused the refund: ${message}`);
    }

    const newRefunded = payment.refundedCents + amount;
    const newStatus: 'REFUNDED' | 'PARTIALLY_REFUNDED' = newRefunded >= payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { refundedCents: newRefunded, status: newStatus },
      }),
      this.prisma.orderEvent.create({
        data: {
          orderId,
          type: 'REFUND_ISSUED',
          actorId: opts.actorId,
          payload: {
            amount,
            reason: opts.reason ?? null,
            note: opts.note ?? null,
            providerRef: payment.providerRef,
            stripeRefundId: stripeRefund.id,
            source: 'admin',
          } satisfies Prisma.InputJsonValue,
        },
      }),
    ]);

    this.realtime.emitOrderStatusChanged(
      {
        orderId,
        status: order.status,
        etaSeconds: 0,
        occurredAt: new Date().toISOString(),
      },
      order.userId,
    );

    return {
      refundId: stripeRefund.id,
      refundedCents: newRefunded,
      remainingCents: payment.amountCents - newRefunded,
      paymentStatus: newStatus,
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
    if (!this.stripe) throw new ServiceUnavailableException('Stripe is not configured');
    if (!this.config.webhookSecret) throw new ServiceUnavailableException('Webhook secret missing');
    if (!signature) throw new BadRequestException('Missing Stripe-Signature header');

    let event: { type: string; data: { object: any } };
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.config.webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown signature error';
      throw new BadRequestException(`Invalid Stripe signature: ${message}`);
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onPaymentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.onPaymentFailed(event.data.object);
        break;
      case 'charge.refunded':
        await this.onRefunded(event.data.object);
        break;
      default:
        this.logger.log(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async onPaymentSucceeded(intent: any): Promise<void> {
    const orderId = typeof intent.metadata?.orderId === 'string' ? intent.metadata.orderId : null;
    const order = orderId ? await this.prisma.order.findUnique({ where: { id: orderId } }) : null;
    if (!order) return;

    const [, updatedOrder] = await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: { providerRef: intent.id },
        data: { status: 'SUCCEEDED', rawJson: intent as Prisma.InputJsonValue },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: order.status === 'CREATED' ? 'PAID' : order.status,
          events: {
            create: {
              type: 'PAYMENT_SUCCEEDED',
              payload: { providerRef: intent.id, amount: intent.amount } satisfies Prisma.InputJsonValue,
            },
          },
        },
      }),
    ]);

    const store = await this.prisma.store.findUnique({
      where: { id: updatedOrder.storeId },
      select: { currentEtaSeconds: true },
    });
    this.realtime.emitOrderStatusChanged(
      {
        orderId: updatedOrder.id,
        status: updatedOrder.status,
        etaSeconds: store?.currentEtaSeconds ?? 0,
        occurredAt: new Date().toISOString(),
      },
      updatedOrder.userId,
    );

    // New PAID order should appear on the KDS board without waiting for the
    // 5s polling tick. We load the fresh row (with items) and broadcast it.
    if (updatedOrder.status === 'PAID') {
      const kdsRow = await this.prisma.order.findUnique({
        where: { id: updatedOrder.id },
        include: { items: true },
      });
      if (kdsRow) {
        this.realtime.emitKdsOrderChanged({
          storeId: updatedOrder.storeId,
          kind: 'created',
          orderId: updatedOrder.id,
          order: {
            id: kdsRow.id,
            orderCode: kdsRow.orderCode,
            status: kdsRow.status,
            pickupMode: kdsRow.pickupMode,
            pickupAt: kdsRow.pickupAt.toISOString(),
            createdAt: kdsRow.createdAt.toISOString(),
            customerName: kdsRow.customerName,
            notes: kdsRow.notes,
            items: kdsRow.items.map((i) => ({
              productSnapshot: i.productSnapshot,
              quantity: i.quantity,
            })),
          },
        });
      }
    }

    // Customer-facing push — "payment confirmed".
    if (updatedOrder.status === 'PAID') {
      const orderLike = {
        id: updatedOrder.id,
        userId: updatedOrder.userId,
        orderCode: updatedOrder.orderCode,
        storeId: updatedOrder.storeId,
        fulfillmentType: updatedOrder.fulfillmentType,
      };
      void this.notifications.notifyOrderStatus(orderLike, 'PAID');
      // Brand-staff push — BRAND_ADMIN + STORE_MANAGER/STAFF assigned to
      // the store get a Telegram notification so they aren't waiting on
      // the polling dashboard.
      void this.notifications.notifyBrandStaffNewOrder(orderLike);
      // Push the order downstream to the connected POS (iiko / Poster).
      // Best-effort fire-and-forget: the queue handles retries internally,
      // and the brand admin gets a Telegram alert if the push exhausts its
      // retry budget. Never blocks the payment webhook.
      void this.pos.enqueueOrderPushIfApplicable(orderLike.id).catch((err: unknown) => {
        this.logger.error(
          `[pos] failed to enqueue order push for order=${orderLike.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    // Credit loyalty points. Fire-and-forget: a ledger hiccup must not roll
    // back a successful payment.
    if (updatedOrder.status === 'PAID') {
      try {
        await this.orders.creditLoyaltyForPayment(updatedOrder.id);
      } catch (err) {
        this.logger.error(
          `[loyalty] failed to credit points for order=${updatedOrder.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      // Receipt + first-time welcome email. MailService is fault-tolerant
      // (transport errors only log), so fire-and-forget is safe here.
      void this.orders.sendPaymentMail(updatedOrder.id);
    }
  }

  private async onPaymentFailed(intent: any): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { providerRef: intent.id },
      data: { status: 'FAILED', rawJson: intent as Prisma.InputJsonValue },
    });
    if (typeof intent.metadata?.orderId === 'string') {
      await this.prisma.orderEvent.create({
        data: {
          orderId: intent.metadata.orderId,
          type: 'PAYMENT_FAILED',
          payload: {
            providerRef: intent.id,
            reason: intent.last_payment_error?.message ?? null,
          } satisfies Prisma.InputJsonValue,
        },
      });
    }
  }

  private async onRefunded(charge: any): Promise<void> {
    const intentId: string | undefined =
      typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!intentId) return;
    await this.prisma.payment.updateMany({
      where: { providerRef: intentId },
      data: {
        status: charge.amount_refunded >= charge.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        refundedCents: charge.amount_refunded,
      },
    });
    const payment = await this.prisma.payment.findFirst({ where: { providerRef: intentId } });
    if (payment) {
      await this.prisma.orderEvent.create({
        data: {
          orderId: payment.orderId,
          type: 'REFUND_ISSUED',
          payload: { amount: charge.amount_refunded, providerRef: intentId } satisfies Prisma.InputJsonValue,
        },
      });
    }
  }

  private toPaymentStatus(s: string): 'PENDING' | 'REQUIRES_ACTION' | 'SUCCEEDED' | 'FAILED' {
    switch (s) {
      case 'succeeded':
        return 'SUCCEEDED';
      case 'canceled':
        return 'FAILED';
      case 'requires_action':
      case 'requires_confirmation':
      case 'requires_payment_method':
        return 'REQUIRES_ACTION';
      default:
        return 'PENDING';
    }
  }
}
