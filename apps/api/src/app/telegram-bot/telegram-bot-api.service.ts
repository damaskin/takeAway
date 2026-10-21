import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** An inline keyboard under a bot message: one row of buttons opening a URL or the Mini App. */
export interface BotKeyboard {
  inline_keyboard: Array<Array<{ text: string; url?: string; web_app?: { url: string } }>>;
}

/**
 * The few Telegram Bot API calls the bot conversation needs, over plain
 * `fetch` like TelegramPushProvider. The token is `TELEGRAM_BOT_TOKEN` —
 * the same bot the Mini App and the order notifications use.
 */
@Injectable()
export class TelegramBotApi {
  private readonly logger = new Logger(TelegramBotApi.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.token();
  }

  /** Plain text — no Markdown, so nothing in it needs escaping. False when Telegram refused it. */
  async sendMessage(chatId: bigint | number, text: string, keyboard?: BotKeyboard): Promise<boolean> {
    try {
      await this.call('sendMessage', {
        chat_id: chatId.toString(),
        text,
        disable_web_page_preview: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
      return true;
    } catch (err) {
      this.logger.warn(`Bot reply to chat ${chatId} failed — ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Points the bot's updates at our webhook. Only private messages are
   * asked for; Telegram sends `secret` back in X-Telegram-Bot-Api-Secret-Token
   * with every update, which is how the webhook knows a request is Telegram's.
   */
  async setWebhook(url: string, secret: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
  }

  private async call(method: string, body: object): Promise<unknown> {
    const token = this.token();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await res.text();
    let parsed: { ok?: boolean; description?: string; result?: unknown } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      // Not JSON — reported below with the status.
    }
    if (!res.ok || parsed.ok !== true) {
      throw new Error(`Telegram ${method} ${res.status}: ${parsed.description ?? raw.slice(0, 200)}`);
    }
    return parsed.result;
  }

  private token(): string | null {
    return this.config.get<string>('TELEGRAM_BOT_TOKEN')?.trim() || null;
  }
}
