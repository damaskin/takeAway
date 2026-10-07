/**
 * Push notifications — device registration (`POST /devices`,
 * `DELETE /devices`) and the transports a message can travel through.
 */

/** A device that registers for push. */
export type PushDeviceType = 'IOS' | 'ANDROID' | 'WEB';

/** The APNs gateway an iOS device token belongs to: store / TestFlight builds — production, debug builds — sandbox. */
export type ApnsEnvironment = 'PRODUCTION' | 'SANDBOX';

/** Body of `POST /devices` and `DELETE /devices`. */
export interface DeviceRegistration {
  type: PushDeviceType;
  /** IOS / ANDROID: the Firebase Cloud Messaging token. */
  pushToken?: string;
  /**
   * IOS only: the raw APNs device token, hex. The API pushes to it directly
   * when APNs is configured and skips the FCM token of the same device.
   */
  apnsToken?: string;
  /** IOS only; PRODUCTION when left out. */
  apnsEnvironment?: ApnsEnvironment;
  /** WEB: the Push API subscription. */
  endpoint?: string;
  keys?: { p256dh: string; auth: string };
  locale?: 'EN' | 'RU';
}

/**
 * A transport that accepted a message: `apns` — the iOS app straight
 * through Apple, `fcm` — the app through Firebase, `webpush` — the browser,
 * `telegram` — the bot.
 */
export type PushTransport = 'apns' | 'fcm' | 'webpush' | 'telegram';

/** A transport a marketing campaign can go out through. */
export type CampaignTransport = PushTransport | 'email';

export const CAMPAIGN_TRANSPORTS: readonly CampaignTransport[] = ['apns', 'fcm', 'webpush', 'telegram', 'email'];
