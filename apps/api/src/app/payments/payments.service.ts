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

import { PrismaService } from '../prisma/prisma.service';
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
  webhooks: {
    constructEvent: (
      body: Buffer | string,
      signature: string,
      secret: string,
    ) => { type: string; data: { object: any } };
  };
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: StripeConfig,
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

    await this.prisma.$transaction([
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
