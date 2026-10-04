import { Injectable, Logger } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ApnsPushProvider } from './providers/apns.provider';
import { FcmPushProvider } from './providers/fcm.provider';
import type { PushAttempt, PushMessage, PushProvider, PushRecipient } from './providers/push-provider.interface';
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

export interface OrderStatusPushOptions {
  expiry?: OrderExpiryInfo;
}

/** A transport that accepted a message. */
export type DeliveryVia = 'fcm' | 'webpush' | 'telegram';

/**
 * What happened to one message for one person across every transport.
 * `no_channel` — nothing to deliver to (no usable device token, no Telegram
 * chat, or the transports they have are not configured on this server).
 */
export interface DeliveryResult {
  outcome: 'sent' | 'failed' | 'no_channel';
  via: DeliveryVia[];
  /** Why delivery failed — or, on a Telegram fallback, why device push did not land. */
  error?: string;
}

/**
 * `push` — app (FCM) and web push, then the Telegram bot when neither landed.
 * `telegram` — the Telegram bot only.
 */
export type DeliveryMode = 'push' | 'telegram';

/** Which transports have credentials on this server. */
export interface TransportStatus {
  fcm: boolean;
  webpush: boolean;
  telegram: boolean;
}

/** The user columns a {@link PushRecipient} is built from. */
export const PUSH_RECIPIENT_SELECT = {
  id: true,
  locale: true,
  telegramUserId: true,
  devices: {
    where: { pushToken: { not: null } },
    select: { pushToken: true, type: true },
  },
} as const;

interface RecipientRow {
  id: string;
  locale: 'EN' | 'RU';
  telegramUserId: bigint | null;
  devices: Array<{ pushToken: string | null; type: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM' }>;
}

/** Builds the provider-facing recipient from a row selected with {@link PUSH_RECIPIENT_SELECT}. */
export function toPushRecipient(user: RecipientRow): PushRecipient {
  return {
    userId: user.id,
    telegramUserId: user.telegramUserId,
    locale: user.locale,
    pushTokens: user.devices
      .filter((d): d is { pushToken: string; type: RecipientRow['devices'][number]['type'] } => Boolean(d.pushToken))
      .map((d) => ({ token: d.pushToken, deviceType: d.type })),
  };
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
 * Customer messages go through {@link NotificationsService.deliver}: app
 * and web push first, the Telegram bot as the fallback. Providers swallow
 * their own errors, so a Telegram/FCM outage never blocks an order
 * transition; whatever did not land is logged at warn with the reason.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramPushProvider,
    private readonly apns: ApnsPushProvider,
    private readonly fcm: FcmPushProvider,
    private readonly webpush: WebPushProvider,
  ) {}

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

    // App / web push first, the Telegram bot when neither landed — most
    // customers order from the Mini App and have no device token at all.
    const result = await this.deliver(recipient, message, 'push');
    if (result.outcome !== 'sent') {
      this.logger.warn(
        `Order ${order.orderCode} ${newStatus} push not delivered to user ${order.userId}: ${
          result.outcome === 'no_channel' ? 'no push token or Telegram chat' : result.error
        }`,
      );
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
   * Delivers one message to one person and says how it went.
   *
   * In `push` mode the device transports run in parallel — FCM for the
   * mobile app (Android and iOS), Web Push for the browser; the APNs stub
   * never sends. When none of them accepted the message and the user has a
   * Telegram chat with the bot, the bot sends it instead. So a Mini App
   * customer (no device tokens) hears from the bot, an app user gets a
   * single app push rather than a push *and* a bot message, and an app user
   * whose token died still gets the message.
   *
   * Never throws; a provider that rejects is reported as a failure.
   */
  async deliver(recipient: PushRecipient, message: PushMessage, mode: DeliveryMode = 'push'): Promise<DeliveryResult> {
    const errors: string[] = [];

    if (mode === 'push') {
      const device: Array<PushProvider & { id: DeliveryVia | 'apns' }> = [this.fcm, this.webpush, this.apns];
      const attempts = await Promise.all(device.map((p) => this.safeAttempt(p, recipient, message)));
      const via: DeliveryVia[] = [];
      device.forEach((p, i) => {
        if (attempts[i]?.status === 'sent' && p.id !== 'apns') via.push(p.id);
      });
      if (via.length > 0) return { outcome: 'sent', via };
      for (const a of attempts) if (a.status === 'failed') errors.push(a.error);
    }

    const tg = await this.safeAttempt(this.telegram, recipient, message);
    if (tg.status === 'sent') {
      return errors.length > 0
        ? { outcome: 'sent', via: ['telegram'], error: errors.join('; ') }
        : { outcome: 'sent', via: ['telegram'] };
    }
    if (tg.status === 'failed') errors.push(tg.error);
    if (errors.length > 0) return { outcome: 'failed', via: [], error: errors.join('; ') };
    return { outcome: 'no_channel', via: [] };
  }

  /** Which transports this server can use — the admin shows it next to a campaign's reach. */
  transportStatus(): TransportStatus {
    return {
      fcm: this.fcm.isConfigured(),
      webpush: this.webpush.isConfigured(),
      telegram: this.telegram.isConfigured(),
    };
  }

  /**
   * Sends one marketing message to one user — the admin's "send a test to
   * me". Honors the user's `notifyPromotions` flag unless `ignoreOptOut`
   * (the test send: the admin asked for it themselves).
   */
  async sendCampaignTo(
    userId: string,
    channel: 'PUSH' | 'TELEGRAM',
    title: string,
    body: string,
    options: { ignoreOptOut?: boolean } = {},
  ): Promise<DeliveryResult | { outcome: 'opted_out'; via: DeliveryVia[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...PUSH_RECIPIENT_SELECT, notifyPromotions: true },
    });
    if (!user) return { outcome: 'no_channel', via: [] };
    if (!user.notifyPromotions && !options.ignoreOptOut) return { outcome: 'opted_out', via: [] };
    const mode: DeliveryMode = channel === 'TELEGRAM' ? 'telegram' : 'push';
    return this.deliver(toPushRecipient(user), { kind: 'generic', title, body }, mode);
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
      select: { ...PUSH_RECIPIENT_SELECT, notifyOrderUpdates: true },
    });
    if (!user) return null;
    return { ...toPushRecipient(user), notifyOrderUpdates: user.notifyOrderUpdates };
  }

  private async safeAttempt(
    provider: PushProvider,
    recipient: PushRecipient,
    message: PushMessage,
  ): Promise<PushAttempt> {
    try {
      return await provider.attempt(recipient, message);
    } catch (err) {
      const error = `${provider.id}: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.warn(`Push provider threw — ${error}`);
      return { status: 'failed', error };
    }
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
