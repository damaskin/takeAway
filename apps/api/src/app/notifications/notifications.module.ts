import { Module } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { ApnsPushProvider } from './providers/apns.provider';
import { FcmPushProvider } from './providers/fcm.provider';
import { TelegramPushProvider } from './providers/telegram-push.provider';

/**
 * Push notifications fan-out. Exports `NotificationsService` so order /
 * delivery / KDS modules can call `notifyOrderStatus(order, status)` after
 * a transition without caring which channel(s) actually reach the user.
 */
@Module({
  providers: [NotificationsService, TelegramPushProvider, ApnsPushProvider, FcmPushProvider],
  exports: [NotificationsService],
})
export class NotificationsModule {}
