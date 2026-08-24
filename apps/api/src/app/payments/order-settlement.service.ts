import { Injectable, Logger } from '@nestjs/common';
import type { Order, OrderEventType, Prisma } from '@prisma/client';

import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PosService } from '../pos/pos.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface SettlePaidOrderOptions {
  /** Order event recorded in the same transaction as the status flip. */
  event: { type: OrderEventType; payload: Prisma.InputJsonValue };
  /**
   * Payment-row update to apply atomically with the order status flip, so a
   * crash can never leave a SUCCEEDED payment against an unpaid order.
   */
  paymentUpdate?: Prisma.PaymentUpdateManyArgs;
}

/**
 * Everything that must happen once money has actually moved for an order.
 *
 * Provider-agnostic on purpose: Stripe webhooks and the Agroprombank
 * card-charge path both land here, so the KDS board, customer/staff push,
 * loyalty credit, POS push and receipt mail behave identically no matter who
 * took the payment.
 */
@Injectable()
export class OrderSettlementService {
  private readonly logger = new Logger(OrderSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly pos: PosService,
  ) {}

  /**
   * Flips a CREATED order to PAID and fans out the side effects. Orders in any
   * other status keep it (a late webhook must not resurrect a cancelled
   * order), but the event is still recorded.
   *
   * Returns the updated order, or `null` when the order no longer exists.
   */
  async settlePaidOrder(orderId: string, options: SettlePaidOrderOptions): Promise<Order | null> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return null;

    const orderUpdate = this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: order.status === 'CREATED' ? 'PAID' : order.status,
        events: { create: { type: options.event.type, payload: options.event.payload } },
      },
    });

    let updatedOrder: Order;
    if (options.paymentUpdate) {
      const [, result] = await this.prisma.$transaction([
        this.prisma.payment.updateMany(options.paymentUpdate),
        orderUpdate,
      ]);
      updatedOrder = result;
    } else {
      updatedOrder = await orderUpdate;
    }

    await this.broadcastStatus(updatedOrder);
    if (updatedOrder.status === 'PAID') {
      await this.pushToKds(updatedOrder);
      this.notifyAndFulfil(updatedOrder);
      await this.creditLoyalty(updatedOrder);
      // MailService swallows transport errors, so fire-and-forget is safe.
      void this.orders.sendPaymentMail(updatedOrder.id);
    }
    return updatedOrder;
  }

  private async broadcastStatus(order: Order): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: order.storeId },
      select: { currentEtaSeconds: true },
    });
    this.realtime.emitOrderStatusChanged(
      {
        orderId: order.id,
        status: order.status,
        etaSeconds: store?.currentEtaSeconds ?? 0,
        occurredAt: new Date().toISOString(),
      },
      order.userId,
    );
  }

  /**
   * A new PAID order should appear on the KDS board without waiting for the
   * 5s polling tick, so we load the fresh row (with items) and broadcast it.
   */
  private async pushToKds(order: Order): Promise<void> {
    const kdsRow = await this.prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
    if (!kdsRow) return;
    this.realtime.emitKdsOrderChanged({
      storeId: order.storeId,
      kind: 'created',
      orderId: order.id,
      order: {
        id: kdsRow.id,
        orderCode: kdsRow.orderCode,
        status: kdsRow.status,
        pickupMode: kdsRow.pickupMode,
        pickupAt: kdsRow.pickupAt.toISOString(),
        createdAt: kdsRow.createdAt.toISOString(),
        customerName: kdsRow.customerName,
        notes: kdsRow.notes,
        items: kdsRow.items.map((i) => ({ productSnapshot: i.productSnapshot, quantity: i.quantity })),
      },
    });
  }

  private notifyAndFulfil(order: Order): void {
    const orderLike = {
      id: order.id,
      userId: order.userId,
      orderCode: order.orderCode,
      storeId: order.storeId,
      fulfillmentType: order.fulfillmentType,
    };
    // Customer-facing push — "payment confirmed".
    void this.notifications.notifyOrderStatus(orderLike, 'PAID');
    // Brand-staff push — BRAND_ADMIN + STORE_MANAGER/STAFF assigned to the
    // store, so they aren't waiting on the polling dashboard.
    void this.notifications.notifyBrandStaffNewOrder(orderLike);
    // Push the order downstream to the connected POS (iiko / Poster).
    // Best-effort: the queue handles retries internally and the brand admin
    // gets a Telegram alert if the push exhausts its retry budget. Never
    // blocks the payment path.
    void this.pos.enqueueOrderPushIfApplicable(order.id).catch((err: unknown) => {
      this.logger.error(`[pos] failed to enqueue order push for order=${order.id}: ${messageOf(err)}`);
    });
  }

  /** A ledger hiccup must not roll back a successful payment. */
  private async creditLoyalty(order: Order): Promise<void> {
    try {
      await this.orders.creditLoyaltyForPayment(order.id);
    } catch (err) {
      this.logger.error(`[loyalty] failed to credit points for order=${order.id}: ${messageOf(err)}`);
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
