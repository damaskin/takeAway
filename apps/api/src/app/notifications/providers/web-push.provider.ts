import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { type PushSubscription } from 'web-push';

import { PrismaService } from '../../prisma/prisma.service';
import type { PushAttempt, PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

/**
 * Browser push via the Web Push API (VAPID).
 *
 * Each WEB device row carries a JSON-encoded `PushSubscription`
 * (`{ endpoint, keys: { p256dh, auth } }`) in `pushToken`. When the
 * browser disposes of a subscription, the push service answers 404/410 —
 * that row is deleted so the next fan-out does not try it again.
 *
 * Disabled when the VAPID env is missing — the provider just logs a
 * warning once and refuses to send.
 */
@Injectable()
export class WebPushProvider implements PushProvider {
  readonly id = 'webpush' as const;

  private readonly logger = new Logger(WebPushProvider.name);
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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

  isConfigured(): boolean {
    return this.enabled;
  }

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    return (await this.attempt(recipient, message)).status === 'sent';
  }

  async attempt(recipient: PushRecipient, message: PushMessage): Promise<PushAttempt> {
    const webTokens = recipient.pushTokens.filter((t) => t.deviceType === 'WEB');
    if (webTokens.length === 0) return { status: 'skipped', reason: 'no_target' };
    if (!this.enabled) return { status: 'skipped', reason: 'not_configured' };

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
          return Promise.reject(Object.assign(new Error('stored subscription is not JSON'), { statusCode: 410 }));
        }
        return webpush.sendNotification(sub, payload).then(() => true);
      }),
    );

    let anyOk = false;
    let error: string | null = null;
    const dead: string[] = [];
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') {
        anyOk = true;
        continue;
      }
      const err = r.reason as { statusCode?: number; message?: string; body?: string } | undefined;
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        const token = webTokens[i]?.token;
        if (token) dead.push(token);
        continue;
      }
      error = `WebPush ${err?.statusCode ?? 'network'}: ${err?.body || err?.message || 'unknown'}`.slice(0, 300);
      this.logger.warn(`WebPush send to user ${recipient.userId} failed — ${error}`);
    }

    if (dead.length > 0) {
      this.logger.log(`Pruning ${dead.length} expired web push subscription(s) of user ${recipient.userId}`);
      await this.prisma.device
        .deleteMany({ where: { userId: recipient.userId, pushToken: { in: dead } } })
        .catch((err: Error) => this.logger.warn(`Could not prune expired web push subscriptions: ${err.message}`));
    }
    if (anyOk) return { status: 'sent' };
    return {
      status: 'failed',
      error: error ?? `WebPush: all ${dead.length} subscription(s) expired — browser unsubscribed, removed`,
    };
  }
}
