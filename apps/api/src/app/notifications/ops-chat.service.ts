import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The platform team's Telegram chat (`OPS_ALERT_TELEGRAM_CHAT_ID`), reached
 * through the bot the rest of the platform already uses
 * (`TELEGRAM_BOT_TOKEN`). Operational alerts go here, and so does anything
 * waiting on a person at the platform, such as a new brand to review.
 *
 * An empty chat id is a normal state — local development, a fresh
 * deployment — and turns the chat off: `send` then does nothing and returns
 * false. Delivery failures are logged and reported the same way, never
 * thrown.
 */
@Injectable()
export class OpsChatService {
  private readonly logger = new Logger(OpsChatService.name);

  constructor(private readonly config: ConfigService) {}

  /** Whether this deployment has an ops chat at all. */
  get enabled(): boolean {
    return Boolean(this.chatId);
  }

  private get chatId(): string | null {
    return this.config.get<string>('OPS_ALERT_TELEGRAM_CHAT_ID') || null;
  }

  /** Plain text, no markup. True once Telegram has accepted the message. */
  async send(text: string): Promise<boolean> {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.chatId;
    if (!botToken || !chatId) return false;

    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) {
        this.logger.error(`Ops chat message not delivered (${res.status}): ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Ops chat message threw: ${(err as Error).message}`);
      return false;
    }
  }
}
