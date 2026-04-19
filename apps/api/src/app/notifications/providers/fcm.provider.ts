import { Injectable, Logger } from '@nestjs/common';

import type { PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

/**
 * Firebase Cloud Messaging provider — STUB for v1.
 *
 * Real implementation would use `firebase-admin` with a service account
 * JSON from `GOOGLE_APPLICATION_CREDENTIALS`, and fan a `messaging().sendEach`
 * call across the Android push tokens.
 *
 * Same rationale as APNs: no Android build yet; swap this stub for a real
 * provider when it lands.
 */
@Injectable()
export class FcmPushProvider implements PushProvider {
  readonly id = 'fcm' as const;

  private readonly logger = new Logger(FcmPushProvider.name);

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    const androidTokens = recipient.pushTokens.filter((t) => t.deviceType === 'ANDROID');
    if (androidTokens.length === 0) return false;
    this.logger.debug(
      `FCM stub — would push "${message.title}" (${message.kind}) to ${androidTokens.length} Android devices for user ${recipient.userId}`,
    );
    return false;
  }
}
