import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelegramBotApi } from './telegram-bot-api.service';
import { telegramBotSettings } from './telegram-bot-config';

/**
 * Tells Telegram where to post the bot's messages, once at startup — and
 * only when this server is explicitly the one: `TELEGRAM_WEBHOOK_URL` and
 * `TELEGRAM_WEBHOOK_SECRET` set, `NODE_ENV=production`, an https URL. A
 * webhook is one per bot, so a developer machine that happens to hold the
 * production token in its `.env` must never claim it; without these
 * settings nothing is called.
 *
 * It does not hold up the start: a refused call is logged and the API runs
 * on, the bot just does not answer until the next start.
 */
@Injectable()
export class TelegramWebhookRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramWebhookRegistrar.name);

  constructor(
    private readonly config: ConfigService,
    private readonly bot: TelegramBotApi,
  ) {}

  onApplicationBootstrap(): void {
    void this.register();
  }

  /** Whether setWebhook was called and accepted. */
  async register(): Promise<boolean> {
    const settings = telegramBotSettings(this.config);
    if (!settings.webhookUrl) return false;
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn('TELEGRAM_WEBHOOK_URL is set outside production — the bot webhook is not registered from here');
      return false;
    }
    if (!/^https:\/\//.test(settings.webhookUrl)) {
      this.logger.error('TELEGRAM_WEBHOOK_URL must be an https URL — the bot webhook is not registered');
      return false;
    }
    if (!settings.webhookSecret) {
      this.logger.error(
        'TELEGRAM_WEBHOOK_SECRET is missing or not 16–256 of [A-Za-z0-9_-] — the bot webhook is not registered',
      );
      return false;
    }
    if (!settings.token) {
      this.logger.error('TELEGRAM_BOT_TOKEN is not set — the bot webhook is not registered');
      return false;
    }
    try {
      await this.bot.setWebhook(settings.webhookUrl, settings.webhookSecret);
      this.logger.log(`Bot webhook registered: ${settings.webhookUrl}`);
      return true;
    } catch (err) {
      this.logger.error(`Bot webhook registration failed — ${(err as Error).message}`);
      return false;
    }
  }
}
