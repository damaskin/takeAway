import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { type PushSubscription } from 'web-push';

import type { PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

/**
 * Browser push via the Web Push API (VAPID).
 *
 * Each WEB device row carries a JSON-encoded `PushSubscription`
 * (`{ endpoint, keys: { p256dh, auth } }`) in `pushToken`. When the
 * browser disposes of a subscription, web-push reports a 404/410 — we
 * swallow it: the device row gets pruned the next time the user
 * re-subscribes (POST /devices replaces the old row by token).
 *
 * Disabled when the VAPID env is missing — the provider just logs a
 * warning once and refuses to send.
 */
@Injectable()
export class WebPushProvider implements PushProvider {
  readonly id = 'webpush' as const;

  private readonly logger = new Logger(WebPushProvider.name);
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY');
    const subject = config.get<string>('VAPID_SUBJECT') ?? 'mailto:noreply@takeaway.local';
    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.enabled = true;
    } else {
      this.logger.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY missing — web push disabled');
      this.enabled = false;
    }
  }

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    if (!this.enabled) return false;
    const webTokens = recipient.pushTokens.filter((t) => t.deviceType === 'WEB');
    if (webTokens.length === 0) return false;

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      orderId: message.orderId,
      kind: message.kind,
    });

    const results = await Promise.allSettled(
      webTokens.map((t) => {
        let sub: PushSubscription;
        try {
          sub = JSON.parse(t.token) as PushSubscription;
        } catch {
          return Promise.resolve(false);
        }
        return webpush.sendNotification(sub, payload).then(() => true);
      }),
    );

    let anyOk = false;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value === true) anyOk = true;
      if (r.status === 'rejected') {
        const err = r.reason as { statusCode?: number; message?: string };
        // 404 / 410 — subscription gone. Anything else worth a debug line.
        if (err?.statusCode !== 404 && err?.statusCode !== 410) {
          this.logger.debug(`WebPush send failed: ${err?.message ?? 'unknown'}`);
        }
      }
    }
    return anyOk;
  }
}
