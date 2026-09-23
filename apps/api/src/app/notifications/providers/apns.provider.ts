import { Injectable, Logger } from '@nestjs/common';

import type { PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

/**
 * Apple Push Notifications provider — STUB, deliberately inert.
 *
 * The Flutter app registers Firebase tokens on iOS as well, and
 * {@link FcmPushProvider} delivers to them through the APNs key uploaded to
 * the Firebase project. A direct APNs sender only becomes useful if a
 * client ever registers raw APNs device tokens; until then this logs.
 */
@Injectable()
export class ApnsPushProvider implements PushProvider {
  readonly id = 'apns' as const;

  private readonly logger = new Logger(ApnsPushProvider.name);

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    const iosTokens = recipient.pushTokens.filter((t) => t.deviceType === 'IOS');
    if (iosTokens.length === 0) return false;
    this.logger.debug(
      `APNs stub — would push "${message.title}" (${message.kind}) to ${iosTokens.length} iOS devices for user ${recipient.userId}`,
    );
    return false;
  }
}
