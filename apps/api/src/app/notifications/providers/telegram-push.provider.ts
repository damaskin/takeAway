import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PushAttempt, PushMessage, PushProvider, PushRecipient } from './push-provider.interface';

/**
 * Telegram Bot push provider. Sends messages via the Bot API to users who
 * have signed in through Telegram (Mini App or Login Widget). The bot token
 * and the chat IDs are driven by what's already in our schema:
 *   - bot token: `TELEGRAM_BOT_TOKEN`
 *   - chat id:   `User.telegramUserId` (private chat with the bot)
 *
 * No third-party SDK — Bot API is plain HTTP, `fetch` is enough. Failures
 * are logged and swallowed so a Telegram outage doesn't wedge order status
 * transitions.
 */
@Injectable()
export class TelegramPushProvider implements PushProvider {
  readonly id = 'telegram' as const;

  private readonly logger = new Logger(TelegramPushProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('TELEGRAM_BOT_TOKEN'));
  }

  async send(recipient: PushRecipient, message: PushMessage): Promise<boolean> {
    return (await this.attempt(recipient, message)).status === 'sent';
  }

  async attempt(recipient: PushRecipient, message: PushMessage): Promise<PushAttempt> {
    const chatId = recipient.telegramUserId;
    if (!chatId) return { status: 'skipped', reason: 'no_target' };

    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      // In dev it's normal to run without a real bot — log instead of failing
      // so the rest of the order flow still works.
      this.logger.debug(
        `TELEGRAM_BOT_TOKEN is not set — skipping Telegram push to ${chatId} (${message.kind}): ${message.title}`,
      );
      return { status: 'skipped', reason: 'not_configured' };
    }

    const text = `*${escapeMarkdown(message.title)}*\n${escapeMarkdown(message.body)}`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.toString(),
          text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const error = `Telegram ${res.status}: ${describeBotError(await res.text())}`;
        this.logger.warn(`Telegram push to ${chatId} failed — ${error}`);
        return { status: 'failed', error };
      }
      return { status: 'sent' };
    } catch (err) {
      const error = `Telegram: ${(err as Error).message}`;
      this.logger.warn(`Telegram push to ${chatId} threw — ${error}`);
      return { status: 'failed', error };
    }
  }
}

/** The Bot API's `description` ("Forbidden: bot was blocked by the user"), or the raw body. */
function describeBotError(raw: string): string {
  try {
    const description = (JSON.parse(raw) as { description?: unknown }).description;
    if (typeof description === 'string') return description;
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return raw.slice(0, 200);
}

/**
 * MarkdownV2 reserves a long list of punctuation. Escape defensively so
 * `!` / `(` / `-` in product names or status strings doesn't 400 the API.
 */
function escapeMarkdown(input: string): string {
  return input.replace(/[_*[\]()~`>#+=|{}.!-]/g, (ch) => `\\${ch}`);
}
