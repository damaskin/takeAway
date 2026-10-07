import { Injectable, Logger } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { PushTransport } from '@takeaway/shared-types';

import { PrismaService } from '../prisma/prisma.service';
import { type ApnsDelivery, ApnsPushProvider, apnsTargets, hasApnsToken } from './providers/apns.provider';
import { FcmPushProvider } from './providers/fcm.provider';
import type {
  PushAttempt,
  PushMessage,
  PushProvider,
  PushRecipient,
  PushTarget,
} from './providers/push-provider.interface';
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
  /** The charge was waiting for the accept and was called off — the card was never touched. */
  notCharged?: boolean;
}

/** Why a store turned an order down — picked on the kitchen board. */
export type StoreRejectReason = 'OUT_OF_STOCK' | 'TOO_BUSY' | 'CLOSING' | 'OTHER';

/** The store turned the order down, so the push can say why and where the money went. */
export interface StoreRejectionInfo {
  reason: StoreRejectReason;
  /** Free text from the kitchen, shown as is. */
  comment?: string | null;
  /**
   * not_charged — the charge was waiting for the accept and never happened;
   * released — the hold came off; refunded — a captured charge went back;
   * pending — the bank still owes the release.
   */
  money: 'not_charged' | 'released' | 'refunded' | 'pending' | 'none';
}

export interface OrderStatusPushOptions {
  expiry?: OrderExpiryInfo;
  rejection?: StoreRejectionInfo;
  /** The bank declined the card when the store accepted the order, so the order was called off. */
  cardDeclined?: boolean;
}

/**
 * A transport that accepted a message: `apns` — the iOS app straight
 * through Apple, `fcm` — the app through Firebase (Android, and iOS devices
 * without a raw APNs token), `webpush` — the browser, `telegram` — the bot.
 */
export type DeliveryVia = PushTransport;

/**
 * What happened to one message for one person across every transport.
 * `no_channel` — nothing to deliver to (no usable device token, no Telegram
 * chat, or the transports they have are not configured on this server).
 */
export interface DeliveryResult {
  outcome: 'sent' | 'failed' | 'no_channel';
  via: DeliveryVia[];
  /**
   * Why delivery failed — or, when it was sent, what failed along the way
   * (an app push that did not land before the Telegram fallback, one of two
   * devices, APNs before its FCM fallback).
   */
  error?: string;
}

/**
 * `push` — app (APNs / FCM) and web push, then the Telegram bot when none landed.
 * `telegram` — the Telegram bot only.
 */
export type DeliveryMode = 'push' | 'telegram';

/** Which transports have credentials on this server. */
export interface TransportStatus {
  apns: boolean;
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
    select: { pushToken: true, type: true, apnsToken: true, apnsEnvironment: true },
  },
} as const;

interface RecipientRow {
  id: string;
  locale: 'EN' | 'RU';
  telegramUserId: bigint | null;
  devices: Array<{
    pushToken: string | null;
    type: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM';
    apnsToken?: string | null;
    apnsEnvironment?: 'PRODUCTION' | 'SANDBOX' | null;
  }>;
}

/** Builds the provider-facing recipient from a row selected with {@link PUSH_RECIPIENT_SELECT}. */
export function toPushRecipient(user: RecipientRow): PushRecipient {
  const pushTokens: PushTarget[] = [];
  for (const d of user.devices) {
    if (!d.pushToken) continue;
    const target: PushTarget = { token: d.pushToken, deviceType: d.type };
    if (d.type === 'IOS' && d.apnsToken) {
      target.apnsToken = d.apnsToken;
      target.apnsEnvironment = d.apnsEnvironment ?? null;
    }
    pushTokens.push(target);
  }
  return { userId: user.id, telegramUserId: user.telegramUserId, locale: user.locale, pushTokens };
}

/** Transitions the customer hears about; everything else they see live in the app. */
/** Each reason once — two devices failing the same way say it once. */
function joinErrors(errors: string[]): string {
  return [...new Set(errors)].join('; ');
}

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
  async notifyBrandStaffNewOrder(order: OrderLike, payment: { paid: boolean } = { paid: true }): Promise<void> {
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
      // Unpaid means the card is charged when the kitchen accepts the order.
      body: payment.paid
        ? `Оплачено, ждёт принятия на кухне. / New paid order awaiting the kitchen.`
        : `Ждёт принятия на кухне, оплата спишется при принятии. / Awaiting the kitchen; the card is charged on accept.`,
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
   * In `push` mode the device transports run in parallel: APNs for iOS
   * devices that registered a raw APNs token (when APNs is configured),
   * FCM for the other app devices (Android, iOS on older app versions),
   * Web Push for the browser. An iOS device pushed through APNs is left out
   * of FCM, so nobody gets the same push twice; only when Apple did not
   * take it is the device's FCM token tried as well.
   *
   * When no device transport accepted the message and the user has a
   * Telegram chat with the bot, the bot sends it instead. So a Mini App
   * customer (no device tokens) hears from the bot, an app user gets a
   * single app push rather than a push *and* a bot message, and an app user
   * whose token died still gets the message. Whatever failed on the way is
   * kept in `error`, also on a result that was sent.
   *
   * Never throws; a provider that rejects is reported as a failure.
   */
  async deliver(recipient: PushRecipient, message: PushMessage, mode: DeliveryMode = 'push'): Promise<DeliveryResult> {
    const errors: string[] = [];

    if (mode === 'push') {
      const via = new Set<DeliveryVia>();
      const note = (id: DeliveryVia, attempt: PushAttempt): void => {
        if (attempt.status === 'sent') via.add(id);
        else if (attempt.status === 'failed') errors.push(attempt.error);
      };

      const direct = this.apns.isConfigured();
      const fcmRecipient: PushRecipient = direct
        ? { ...recipient, pushTokens: recipient.pushTokens.filter((t) => !hasApnsToken(t)) }
        : recipient;
      const [apns, fcm, webpush] = await Promise.all([
        direct ? this.safeApns(recipient, message) : null,
        this.safeAttempt(this.fcm, fcmRecipient, message),
        this.safeAttempt(this.webpush, recipient, message),
      ]);
      if (apns) note('apns', apns.attempt);
      note('fcm', fcm);
      // iOS devices Apple did not take the push for get it through FCM instead.
      if (apns && apns.unreached.length > 0) {
        note('fcm', await this.safeAttempt(this.fcm, { ...recipient, pushTokens: apns.unreached }, message));
      }
      note('webpush', webpush);

      if (via.size > 0) {
        const order: DeliveryVia[] = ['apns', 'fcm', 'webpush'];
        const sent = order.filter((id) => via.has(id));
        return errors.length > 0
          ? { outcome: 'sent', via: sent, error: joinErrors(errors) }
          : { outcome: 'sent', via: sent };
      }
    }

    const tg = await this.safeAttempt(this.telegram, recipient, message);
    if (tg.status === 'sent') {
      return errors.length > 0
        ? { outcome: 'sent', via: ['telegram'], error: joinErrors(errors) }
        : { outcome: 'sent', via: ['telegram'] };
    }
    if (tg.status === 'failed') errors.push(tg.error);
    if (errors.length > 0) return { outcome: 'failed', via: [], error: joinErrors(errors) };
    return { outcome: 'no_channel', via: [] };
  }

  /** Which transports this server can use — the admin shows it next to a campaign's reach. */
  transportStatus(): TransportStatus {
    return {
      apns: this.apns.isConfigured(),
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

  /** {@link safeAttempt} for APNs, which also says which devices it did not reach. */
  private async safeApns(recipient: PushRecipient, message: PushMessage): Promise<ApnsDelivery> {
    try {
      return await this.apns.deliver(recipient, message);
    } catch (err) {
      const error = `apns: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.warn(`Push provider threw — ${error}`);
      return { attempt: { status: 'failed', error }, unreached: apnsTargets(recipient.pushTokens) };
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
        if (options.rejection) return this.buildRejectedMessage(code, ru, options.rejection, message);
        if (options.cardDeclined) {
          return ru
            ? message(
                'order_status',
                `Заказ ${code} отменён`,
                'Банк отклонил оплату картой, деньги не списаны. Оформите заказ ещё раз с другой картой.',
              )
            : message(
                'order_status',
                `Order ${code} cancelled`,
                'The bank declined your card, so you were not charged. Please order again with another card.',
              );
        }
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
      not_charged: ['Деньги с карты не списывались.', 'Your card was not charged.'],
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
    // A released card hold (or a called-off deferred charge) means the customer
    // paid and the store never took the order; without one, the payment itself
    // was never completed.
    if (expiry?.notCharged) {
      return ru
        ? message(
            'order_status',
            `Заказ ${code} не принят`,
            'Заведение не подтвердило заказ вовремя. Деньги с карты не списывались.',
          )
        : message(
            'order_status',
            `Order ${code} was not accepted`,
            'The store did not confirm it in time. Your card was not charged.',
          );
    }
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
