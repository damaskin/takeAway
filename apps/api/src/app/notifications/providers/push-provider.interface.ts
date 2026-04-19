export interface PushRecipient {
  userId: string;
  telegramUserId?: bigint | null;
  pushTokens: Array<{ token: string; deviceType: 'IOS' | 'ANDROID' | 'WEB' | 'TELEGRAM' }>;
  locale: 'EN' | 'RU';
}

export interface PushMessage {
  /** Short headline — keeps SMS/WebPush usable too. */
  title: string;
  /** Full body. Telegram renders as-is (plain text or HTML depending on provider). */
  body: string;
  /** Optional deep-link back to the order. */
  orderId?: string;
  /** Machine-readable tag so each provider can route correctly. */
  kind: 'order_status' | 'order_ready' | 'order_out_for_delivery' | 'order_delivered' | 'generic';
}

export interface PushProvider {
  /** Human-readable provider id for logging. */
  readonly id: 'telegram' | 'apns' | 'fcm';
  /** Non-fatal: providers should swallow their own errors and return false. */
  send(recipient: PushRecipient, message: PushMessage): Promise<boolean>;
}
