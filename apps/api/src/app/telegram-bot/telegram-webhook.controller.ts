import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/decorators/public.decorator';
import { TelegramWebhookService } from './telegram-webhook.service';

/**
 * Where Telegram posts the bot's messages (`setWebhook`, see
 * TelegramWebhookRegistrar). Public, and trusted only with the webhook
 * secret. Left out of the API docs: nobody but Telegram calls it.
 */
@ApiExcludeController()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly webhook: TelegramWebhookService) {}

  /**
   * Always 200 for an update with the right secret, whatever is in it —
   * Telegram resends anything else. Throttled well above what this bot
   * gets; Telegram retries a 429 later on its own.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async receive(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    this.webhook.assertFromTelegram(secret);
    await this.webhook.handle(update);
    return { ok: true };
  }
}
