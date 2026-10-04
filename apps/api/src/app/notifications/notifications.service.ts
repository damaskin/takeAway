import { Injectable, Logger } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ApnsPushProvider } from './providers/apns.provider';
import { FcmPushProvider } from './providers/fcm.provider';
import type { PushMessage, PushProvider, PushRecipient } from './providers/push-provider.interface';
import { TelegramPushProvider } from './providers/telegram-push.provider';
import { WebPushProvider } from './providers/web-push.provider';

interface OrderLike {
  id: string;
  userId: string;
  orderCode: string;
  storeId: string;
  fulfillmentType: 'PICKUP' | 'DINE_IN' | 'DELIVERY';
}

/** Why an order expired, so the push can say what happened to the money. */
export interface OrderExpiryInfo {
  reason: 'payment_timeout' | 'not_accepted';
  /** A card hold was reversed — the customer paid and the store never accepted. */
  holdReleased: boolean;
}

/** Why a store turned an order down — picked on the kitchen board. */
export type StoreRejectReason = 'OUT_OF_STOCK' | 'TOO_BUSY' | 'CLOSING' | 'OTHER';

/** The store turned the order down, so the push can say why and where the money went. */
export interface StoreRejectionInfo {
  reason: StoreRejectReason;
  /** Free text from the kitchen, shown as is. */
  comment?: string | null;
  /** released — the hold came off; refunded — a captured charge went back; pending — the bank still owes the release. */
  money: 'released' | 'refunded' | 'pending' | 'none';
}

export interface OrderStatusPushOptions {
  expiry?: OrderExpiryInfo;
  rejection?: StoreRejectionInfo;
}

/** Transitions the customer hears about; everything else they see live in the app. */
const NOTIFIED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'ACCEPTED',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
]);

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
    private readonly webpush: WebPushProvider,
  ) {
    this.providers = [this.telegram, this.apns, this.fcm, this.webpush];
  }

  /** Push a customer-facing notification for an order status transition. */
  async notifyOrderStatus(
    order: OrderLike,
    newStatus: OrderStatus,
    options: OrderStatusPushOptions = {},
  ): Promise<void> {
    if (!NOTIFIED_STATUSES.has(newStatus)) return; // see buildOrderStatusMessage

    const recipient = await this.loadRecipient(order.userId);
    if (!recipient) return;
    // User opted out of order push on /profile/notifications.
    if (!recipient.notifyOrderUpdates) return;

    const message = this.buildOrderStatusMessage(order, newStatus, recipient.locale, options);
    if (!message) return;

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

  /**
   * Ping a single rider that a delivery order was handed to them. Fires on
   * manager assignment and on the READY transition when a rider is already
   * bound to the order (`notifyRiderReady`).
   */
  async notifyRider(orderLike: OrderLike, riderId: string, kind: 'assigned' | 'ready'): Promise<void> {
    const recipient = await this.loadRecipient(riderId);
    if (!recipient) return;
    const codeTag = `#${orderLike.orderCode}`;
    const message: PushMessage =
      kind === 'assigned'
        ? {
            kind: 'order_status',
            title: `Новый заказ ${codeTag}`,
            body: `Вам назначили доставку. / You've been assigned a delivery.`,
            orderId: orderLike.id,
          }
        : {
            kind: 'order_ready',
            title: `Заказ ${codeTag} готов`,
            body: `Можно забирать и везти клиенту. / Ready to pick up and deliver.`,
            orderId: orderLike.id,
          };
    await this.telegram.send(recipient, message);
  }

  /**
   * Notify staff of a brand when a new paid order lands for one of their
   * stores. Targets:
   *   - BRAND_ADMIN(s) who own the brand.
   *   - STORE_MANAGER / STAFF assigned to the store via the UserStore pivot.
   * Only users with a linked `telegramUserId` actually receive a push —
   * the rest are silently skipped (they rely on the in-app realtime UI).
   */
  async notifyBrandStaffNewOrder(order: OrderLike): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: order.storeId },
      select: { brandId: true, name: true },
    });
    if (!store) return;

    const recipients = await this.prisma.user.findMany({
      where: {
        telegramUserId: { not: null },
        blockedAt: null,
        OR: [
          { role: 'BRAND_ADMIN', ownedBrands: { some: { id: store.brandId } } },
          { userStores: { some: { storeId: order.storeId } } },
        ],
      },
      select: { id: true, locale: true, telegramUserId: true },
    });
    if (recipients.length === 0) return;

    const message: PushMessage = {
      kind: 'order_status',
      title: `Новый заказ #${order.orderCode} · ${store.name}`,
      body: `Оплачено, ждёт принятия на кухне. / New paid order awaiting the kitchen.`,
      orderId: order.id,
    };

    await Promise.allSettled(
      recipients.map((u) =>
        this.telegram.send(
          { userId: u.id, locale: u.locale, telegramUserId: u.telegramUserId, pushTokens: [] },
          message,
        ),
      ),
    );
  }

  /**
   * Ping store staff once when a customer geofence resolves to HERE.
   * Targets the same audience as new-paid-order push (BRAND_ADMINs of the
   * brand + STORE_MANAGER/STAFF assigned to the store), but copy is the
   * "customer arrived" variant. Idempotency lives at the call site
   * (one-shot CUSTOMER_HERE event), so this just fans out.
   */
  async notifyStaffCustomerHere(order: OrderLike): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: order.storeId },
      select: { brandId: true, name: true },
    });
    if (!store) return;

    const recipients = await this.prisma.user.findMany({
      where: {
        telegramUserId: { not: null },
        blockedAt: null,
        OR: [
          { role: 'BRAND_ADMIN', ownedBrands: { some: { id: store.brandId } } },
          { userStores: { some: { storeId: order.storeId } } },
        ],
      },
      select: { id: true, locale: true, telegramUserId: true },
    });
    if (recipients.length === 0) return;

    const message: PushMessage = {
      kind: 'order_status',
      title: `Клиент приехал · #${order.orderCode}`,
      body: `Гость на месте, заберите готовый заказ. / Customer is at the store — hand off the order.`,
      orderId: order.id,
    };

    await Promise.allSettled(
      recipients.map((u) =>
        this.telegram.send(
          { userId: u.id, locale: u.locale, telegramUserId: u.telegramUserId, pushTokens: [] },
          message,
        ),
      ),
    );
  }

  /**
   * Generic broadcast helper used by the marketing campaign engine. Sends
   * a `generic`-kind PushMessage to a single user via the requested
   * channel. Returns true when at least one transport accepted the
   * message; the campaign service uses that to update sent/failed counters.
   *
   * Honors the user's `notifyPromotions` flag — opted-out users are
   * silently skipped (treated as "no recipient" rather than "failure").
   */
  async sendCampaignTo(
    userId: string,
    channel: 'PUSH' | 'TELEGRAM',
    title: string,
    body: string,
  ): Promise<'sent' | 'opted_out' | 'failed'> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        locale: true,
        telegramUserId: true,
        notifyPromotions: true,
        devices: { where: { pushToken: { not: null } }, select: { pushToken: true, type: true } },
      },
    });
    if (!user || !user.notifyPromotions) return 'opted_out';

    const recipient: PushRecipient = {
      userId: user.id,
      telegramUserId: user.telegramUserId,
      locale: user.locale,
      pushTokens: user.devices
        .filter((d): d is { pushToken: string; type: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM' } => Boolean(d.pushToken))
        .map((d) => ({ token: d.pushToken, deviceType: d.type })),
    };
    const message: PushMessage = { kind: 'generic', title, body };

    if (channel === 'TELEGRAM') {
      const ok = await this.telegram.send(recipient, message).catch(() => false);
      return ok ? 'sent' : 'failed';
    }
    // PUSH — fan out across APNs / FCM / WebPush; success = any one accepted.
    const results = await Promise.allSettled(
      [this.apns, this.fcm, this.webpush].map((p) => p.send(recipient, message)),
    );
    return results.some((r) => r.status === 'fulfilled' && r.value === true) ? 'sent' : 'failed';
  }

  /**
   * Telegram-pings every BRAND_ADMIN of a brand when an outgoing POS push
   * has exhausted its retry budget. Same fan-out shape as
   * {@link notifyBrandStaffNewOrder} but scoped to brand owners — store
   * staff don't act on POS-integration health.
   */
  async notifyBrandAdminPosError(input: { brandId: string; orderCode: string; message: string }): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: {
        telegramUserId: { not: null },
        blockedAt: null,
        role: 'BRAND_ADMIN',
        ownedBrands: { some: { id: input.brandId } },
      },
      select: { id: true, locale: true, telegramUserId: true },
    });
    if (recipients.length === 0) return;

    const message: PushMessage = {
      kind: 'order_status',
      title: `POS: заказ #${input.orderCode} не ушёл в кассу`,
      body: `${input.message}. Заказ нужно ввести в POS вручную. / Order failed to push to your POS — enter it manually.`,
    };

    await Promise.allSettled(
      recipients.map((u) =>
        this.telegram.send(
          { userId: u.id, locale: u.locale, telegramUserId: u.telegramUserId, pushTokens: [] },
          message,
        ),
      ),
    );
  }

  private async loadRecipient(userId: string): Promise<(PushRecipient & { notifyOrderUpdates: boolean }) | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        locale: true,
        telegramUserId: true,
        notifyOrderUpdates: true,
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
      notifyOrderUpdates: user.notifyOrderUpdates,
      pushTokens: user.devices
        .filter((d): d is { pushToken: string; type: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM' } => Boolean(d.pushToken))
        .map((d) => ({ token: d.pushToken, deviceType: d.type })),
    };
  }

  /**
   * Customer copy, in the customer's language. Only the moments the customer
   * waits for get a push — accepted, ready, on the way, delivered — plus the
   * ones that end the order without them doing anything. CREATED and PAID
   * happen while the customer is still on the checkout screen, and under
   * `AGROPROMBANK_HOLD_UNTIL_ACCEPTED` PAID lands in the same second as
   * ACCEPTED, so a push for each would arrive as a pair.
   */
  private buildOrderStatusMessage(
    order: OrderLike,
    status: OrderStatus,
    locale: PushRecipient['locale'],
    options: OrderStatusPushOptions,
  ): PushMessage | null {
    const ru = locale !== 'EN';
    const code = `#${order.orderCode}`;
    const message = (kind: PushMessage['kind'], title: string, body: string): PushMessage => ({
      kind,
      title,
      body,
      orderId: order.id,
    });

    switch (status) {
      case 'ACCEPTED':
        return ru
          ? message('order_status', `Заказ ${code} принят`, 'Заведение уже готовит ваш заказ.')
          : message('order_status', `Order ${code} accepted`, 'The store is preparing your order.');
      case 'READY':
        if (order.fulfillmentType === 'DELIVERY') {
          return ru
            ? message('order_ready', `Заказ ${code} готов`, 'Ждём курьера, скоро выедет к вам.')
            : message('order_ready', `Order ${code} is ready`, 'Waiting for the rider to pick it up.');
        }
        return ru
          ? message('order_ready', `Заказ ${code} готов ☕`, 'Можно забирать у стойки.')
          : message('order_ready', `Order ${code} is ready ☕`, 'Pick it up at the counter.');
      case 'OUT_FOR_DELIVERY':
        return ru
          ? message('order_out_for_delivery', `Заказ ${code} в пути 🛵`, 'Курьер выехал к вам.')
          : message('order_out_for_delivery', `Order ${code} is on its way 🛵`, 'The rider is heading to you.');
      case 'DELIVERED':
        return ru
          ? message('order_delivered', `Заказ ${code} доставлен`, 'Приятного аппетита!')
          : message('order_delivered', `Order ${code} delivered`, 'Enjoy!');
      case 'CANCELLED':
        if (options.rejection) return this.buildRejectedMessage(code, ru, options.rejection, message);
        return ru
          ? message('order_status', `Заказ ${code} отменён`, 'Если это неожиданно, свяжитесь с заведением.')
          : message('order_status', `Order ${code} cancelled`, 'Please contact the store if this is unexpected.');
      case 'EXPIRED':
        return this.buildExpiredMessage(code, ru, options.expiry, message);
      default:
        // CREATED / PAID: see above. IN_PROGRESS is chatty (the customer sees
        // it live anyway); PICKED_UP — the cup is already in their hand.
        return null;
    }
  }

  /** The store said no: why, in a sentence, and what happened to the money. */
  private buildRejectedMessage(
    code: string,
    ru: boolean,
    rejection: StoreRejectionInfo,
    message: (kind: PushMessage['kind'], title: string, body: string) => PushMessage,
  ): PushMessage {
    const reasons: Record<StoreRejectReason, [string, string]> = {
      OUT_OF_STOCK: ['Части позиций сейчас нет в наличии.', 'Some items are out of stock.'],
      TOO_BUSY: ['Заведение сейчас перегружено заказами.', 'The store is too busy right now.'],
      CLOSING: ['Заведение закрывается.', 'The store is closing.'],
      OTHER: ['Заведение не может принять заказ.', 'The store cannot take the order.'],
    };
    const money: Record<StoreRejectionInfo['money'], [string, string]> = {
      released: [
        'Деньги не списаны, блокировка на карте снята.',
        'You were not charged and the card hold is released.',
      ],
      refunded: ['Деньги вернутся на карту.', 'The money is on its way back to your card.'],
      pending: ['Блокировка на карте будет снята автоматически.', 'The card hold will be released automatically.'],
      none: ['', ''],
    };
    const comment = rejection.comment?.trim();
    const [reasonRu, reasonEn] = reasons[rejection.reason];
    const [moneyRu, moneyEn] = money[rejection.money];
    const body = [ru ? reasonRu : reasonEn, comment, ru ? moneyRu : moneyEn].filter(Boolean).join(' ');
    return ru
      ? message('order_status', `Заказ ${code} отклонён`, body)
      : message('order_status', `Order ${code} was declined`, body);
  }

  private buildExpiredMessage(
    code: string,
    ru: boolean,
    expiry: OrderExpiryInfo | undefined,
    message: (kind: PushMessage['kind'], title: string, body: string) => PushMessage,
  ): PushMessage {
    // A released card hold means the payment went through and the store never
    // took the order; without one, the payment itself was never completed.
    if (expiry?.holdReleased) {
      return ru
        ? message(
            'order_status',
            `Заказ ${code} не принят`,
            'Заведение не подтвердило заказ вовремя. Деньги не списаны, бронь на карте снята.',
          )
        : message(
            'order_status',
            `Order ${code} was not accepted`,
            'The store did not confirm it in time. You were not charged and the card hold is released.',
          );
    }
    if (expiry?.reason === 'not_accepted') {
      return ru
        ? message('order_status', `Заказ ${code} не принят`, 'Заведение не подтвердило заказ вовремя.')
        : message('order_status', `Order ${code} was not accepted`, 'The store did not confirm it in time.');
    }
    return ru
      ? message(
          'order_status',
          `Заказ ${code} отменён`,
          'Оплата не завершилась. Промокод, бонусы и баланс подарочной карты возвращены.',
        )
      : message(
          'order_status',
          `Order ${code} cancelled`,
          'The payment was not completed. Your promo code, points and gift card balance are back.',
        );
  }
}
