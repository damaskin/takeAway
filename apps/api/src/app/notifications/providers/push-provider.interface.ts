/** One registered device of a recipient, as the providers see it. */
export interface PushTarget {
  /** FCM token (IOS / ANDROID) or a JSON-encoded web push subscription (WEB). */
  token: string;
  deviceType: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM';
  /** Raw APNs device token (hex) an iOS app registered next to its FCM token. */
  apnsToken?: string | null;
  /** The APNs gateway the token belongs to; production when unknown. */
  apnsEnvironment?: 'PRODUCTION' | 'SANDBOX' | null;
}

export interface PushRecipient {
  userId: string;
  telegramUserId?: bigint | null;
  pushTokens: PushTarget[];
  locale: 'EN' | 'RU';
}

export interface PushMessage {
  /** Short headline — keeps SMS/WebPush usable too. */
  title: string;
  /** Full body. Telegram renders as-is (plain text or HTML depending on provider). */
  body: string;
  /** Optional deep-link back to the order. */
  orderId?: string;
  /**
   * Machine-readable tag so each provider can route correctly. `order_delayed`:
   * the order ran past its promised time (`data.orderId`), sent once. `campaign` —
   * a brand's campaign, `announcement` — a platform announcement: both have
   * an item in the customer's «Уведомления», and a tap opens it.
   */
  kind:
    | 'order_status'
    | 'order_ready'
    | 'order_out_for_delivery'
    | 'order_delivered'
    | 'order_delayed'
    | 'generic'
    | 'campaign'
    | 'announcement';
  /** The inbox item a `campaign` / `announcement` push stands for. */
  notificationId?: string;
  /** Where the announcement links: a store's menu, or a brand's. */
  storeId?: string;
  brandId?: string;
}

/** Inbox kinds: the push stands for an item of «Уведомления». */
export function isInboxPush(message: Pick<PushMessage, 'kind'>): boolean {
  return message.kind === 'campaign' || message.kind === 'announcement';
}

/** Marketing, not order news: Android files it in the quiet channel. */
export function isPromotionalPush(message: Pick<PushMessage, 'kind'>): boolean {
  return message.kind === 'generic' || isInboxPush(message);
}

/** The ids a push carries next to the alert, for the app to route a tap (FCM data, APNs custom keys, web push). */
export function pushData(message: PushMessage): Record<string, string> {
  const data: Record<string, string> = { kind: message.kind };
  if (message.orderId) data['orderId'] = message.orderId;
  if (message.notificationId) data['notificationId'] = message.notificationId;
  if (message.storeId) data['storeId'] = message.storeId;
  if (message.brandId) data['brandId'] = message.brandId;
  return data;
}

/**
 * What one provider did with one message for one recipient.
 *
 * `skipped` is not a failure: the provider is not configured on this server
 * (`not_configured`) or the recipient has nothing it can deliver to
 * (`no_target` — no token of its kind, no Telegram chat). The caller uses
 * the difference to tell "nobody could be reached" from "delivery broke".
 */
export type PushAttempt =
  | { status: 'sent' }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: 'not_configured' | 'no_target' };

export interface PushProvider {
  /** Human-readable provider id for logging. */
  readonly id: 'telegram' | 'apns' | 'fcm' | 'webpush';
  /** Whether the server has the credentials this provider needs. */
  isConfigured(): boolean;
  /** Non-fatal: providers swallow their own errors and report them in the result. */
  attempt(recipient: PushRecipient, message: PushMessage): Promise<PushAttempt>;
  /** Shorthand for `attempt(...).status === 'sent'`. */
  send(recipient: PushRecipient, message: PushMessage): Promise<boolean>;
}
