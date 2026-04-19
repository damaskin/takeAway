import { Injectable, Logger } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ApnsPushProvider } from './providers/apns.provider';
import { FcmPushProvider } from './providers/fcm.provider';
import type { PushMessage, PushProvider, PushRecipient } from './providers/push-provider.interface';
import { TelegramPushProvider } from './providers/telegram-push.provider';

interface OrderLike {
  id: string;
  userId: string;
  orderCode: string;
  storeId: string;
  fulfillmentType: 'PICKUP' | 'DINE_IN' | 'DELIVERY';
}

/**
 * Fans out user-facing notifications. Only order-status events are wired
 * today — the call site decides which status changes warrant a push
 * (accepting every status would spam the user).
 *
 * Providers are called in parallel; each swallows its own errors and
 * returns a boolean for logging. A total failure doesn't propagate, so
 * a Telegram/APNs outage never blocks an order transition.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly providers: PushProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramPushProvider,
    private readonly apns: ApnsPushProvider,
    private readonly fcm: FcmPushProvider,
  ) {
    this.providers = [this.telegram, this.apns, this.fcm];
  }

  /** Push a customer-facing notification for an order status transition. */
  async notifyOrderStatus(order: OrderLike, newStatus: OrderStatus): Promise<void> {
    const message = this.buildOrderStatusMessage(order, newStatus);
    if (!message) return; // some transitions we deliberately don't notify on

    const recipient = await this.loadRecipient(order.userId);
    if (!recipient) return;

    // Parallel fan-out; log provider results for debugging but never throw.
    const results = await Promise.allSettled(
      this.providers.map((p) => p.send(recipient, message).then((ok) => ({ id: p.id, ok }))),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(`Push provider rejected: ${(r.reason as Error)?.message}`);
      }
    }
  }

  private async loadRecipient(userId: string): Promise<PushRecipient | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        locale: true,
        telegramUserId: true,
        devices: {
          where: { pushToken: { not: null } },
          select: { pushToken: true, type: true },
        },
      },
    });
    if (!user) return null;
    return {
      userId: user.id,
      telegramUserId: user.telegramUserId,
      locale: user.locale,
      pushTokens: user.devices
        .filter((d): d is { pushToken: string; type: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM' } => Boolean(d.pushToken))
        .map((d) => ({ token: d.pushToken, deviceType: d.type })),
    };
  }

  /**
   * Copy is intentionally very small for v1. Localization is a follow-up:
   * for now we keep it friendly and use both languages in the body so
   * no customer is left staring at the wrong language.
   */
  private buildOrderStatusMessage(order: OrderLike, status: OrderStatus): PushMessage | null {
    const codeTag = `#${order.orderCode}`;
    switch (status) {
      case 'ACCEPTED':
        return {
          kind: 'order_status',
          title: `Заказ ${codeTag} принят`,
          body: `Кухня приступает к вашему заказу. / Your order has been accepted.`,
          orderId: order.id,
        };
      case 'READY':
        return {
          kind: 'order_ready',
          title: `Заказ ${codeTag} готов ☕`,
          body:
            order.fulfillmentType === 'DELIVERY'
              ? `Ждём курьера. / Awaiting a rider.`
              : `Заберите у стойки. / Ready for pickup.`,
          orderId: order.id,
        };
      case 'OUT_FOR_DELIVERY':
        return {
          kind: 'order_out_for_delivery',
          title: `Заказ ${codeTag} в пути 🛵`,
          body: `Курьер выехал к вам. / Rider is on the way.`,
          orderId: order.id,
        };
      case 'DELIVERED':
        return {
          kind: 'order_delivered',
          title: `Заказ ${codeTag} доставлен ✅`,
          body: `Приятного аппетита! / Enjoy!`,
          orderId: order.id,
        };
      case 'CANCELLED':
        return {
          kind: 'order_status',
          title: `Заказ ${codeTag} отменён`,
          body: `Свяжитесь с нами, если это неожиданно. / Please contact us if unexpected.`,
          orderId: order.id,
        };
      case 'CREATED':
      case 'PAID':
      case 'IN_PROGRESS':
      case 'PICKED_UP':
      case 'EXPIRED':
      default:
        // PAID confirmation is handled by the payment provider's own receipt;
        // IN_PROGRESS is chatty; PICKED_UP the user already has the cup in
        // hand. EXPIRED triggers a separate cleanup flow (not v1).
        return null;
    }
  }
}
