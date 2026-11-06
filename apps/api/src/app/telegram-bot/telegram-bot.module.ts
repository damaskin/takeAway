import { Module } from '@nestjs/common';

import { TelegramBotApi } from './telegram-bot-api.service';
import { TelegramNotifyLinkController } from './telegram-notify-link.controller';
import { TelegramNotifyLinkService } from './telegram-notify-link.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookRegistrar } from './telegram-webhook-registrar.service';
import { TelegramWebhookService } from './telegram-webhook.service';

/**
 * The bot as a conversation: the webhook Telegram posts to, and linking a
 * staff account's notification chat through it. Sending order messages to
 * a chat stays with NotificationsModule (TelegramPushProvider). The bot API
 * is exported for plain messages with a button — the password-reset link.
 */
@Module({
  controllers: [TelegramWebhookController, TelegramNotifyLinkController],
  providers: [TelegramBotApi, TelegramNotifyLinkService, TelegramWebhookService, TelegramWebhookRegistrar],
  exports: [TelegramBotApi],
})
export class TelegramBotModule {}
