import { Injectable, Logger } from '@nestjs/common';

import type { PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

/**
 * Apple Push Notifications provider — STUB for v1.
 *
 * To go live:
 *   1. Pick a library (`@parse/node-apn` or similar) and wire a real
 *      certificate / JWT loader in the constructor.
 *   2. Switch `send()` from a log to a real call that targets the iOS
 *      device push tokens from `recipient.pushTokens` where
 *      `deviceType === 'IOS'`.
 *
 * Not wired today because we don't yet have an iOS build; this stub keeps
 * the NotificationsService call site clean so swapping to a real provider
 * is a one-line change in the module factory.
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
