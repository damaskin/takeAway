import { Module } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { OpsChatService } from './ops-chat.service';
import { ApnsPushProvider } from './providers/apns.provider';
import { FcmPushProvider } from './providers/fcm.provider';
import { TelegramPushProvider } from './providers/telegram-push.provider';
import { WebPushProvider } from './providers/web-push.provider';

/**
 * Push notifications fan-out. Exports `NotificationsService` so order /
 * delivery / KDS modules can call `notifyOrderStatus(order, status)` after
 * a transition without caring which channel(s) actually reach the user,
 * and `OpsChatService` for messages meant for the platform team.
 */
@Module({
  providers: [
    NotificationsService,
    OpsChatService,
    TelegramPushProvider,
    ApnsPushProvider,
    FcmPushProvider,
    WebPushProvider,
  ],
  exports: [NotificationsService, OpsChatService],
})
export class NotificationsModule {}
