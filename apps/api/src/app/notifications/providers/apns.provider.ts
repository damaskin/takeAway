import { Injectable, Logger } from '@nestjs/common';

import type { PushAttempt, PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

/**
 * Apple Push Notifications provider — STUB, deliberately inert.
 *
 * The Flutter app registers Firebase tokens on iOS as well, and
 * {@link FcmPushProvider} delivers to them through the APNs key uploaded to
 * the Firebase project. A direct APNs sender only becomes useful if a
 * client ever registers raw APNs device tokens; until then it reports
 * itself as not configured, so iOS tokens are never counted as failures
 * here.
 */
@Injectable()
export class ApnsPushProvider implements PushProvider {
  readonly id = 'apns' as const;

  private readonly logger = new Logger(ApnsPushProvider.name);

  isConfigured(): boolean {
    return false;
  }

  async attempt(recipient: PushRecipient, message: PushMessage): Promise<PushAttempt> {
    const iosTokens = recipient.pushTokens.filter((t) => t.deviceType === 'IOS');
    if (iosTokens.length === 0) return { status: 'skipped', reason: 'no_target' };
    this.logger.debug(
      `APNs stub — FCM handles iOS; not pushing "${message.title}" (${message.kind}) directly to ${iosTokens.length} iOS devices of user ${recipient.userId}`,
    );
    return { status: 'skipped', reason: 'not_configured' };
  }

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    return (await this.attempt(recipient, message)).status === 'sent';
  }
}
