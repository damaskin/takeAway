import type { ConfigService } from '@nestjs/config';

/** What Telegram accepts as a webhook secret token. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * The bot conversation's settings, read in one place:
 *
 * - `TELEGRAM_WEBHOOK_URL` — where Telegram posts the bot's messages, e.g.
 *   `https://api.takeaway.md/api/telegram/webhook`. The API registers it
 *   with Telegram at startup, and only in production (NODE_ENV) with an
 *   https URL: a developer's machine, which may well hold the production
 *   bot token in its `.env`, never takes the bot's updates away from the
 *   server.
 * - `TELEGRAM_WEBHOOK_SECRET` — 16–256 of [A-Za-z0-9_-] (`openssl rand -hex
 *   32`). Telegram sends it back with every update; without it the webhook
 *   endpoint is off (404).
 * - `TELEGRAM_BOT_USERNAME` — the bot's t.me name for the link.
 */
export interface TelegramBotSettings {
  token: string | null;
  username: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  miniAppUrl: string | null;
}

export function telegramBotSettings(config: ConfigService): TelegramBotSettings {
  const read = (key: string): string | null => config.get<string>(key)?.trim() || null;
  const secret = read('TELEGRAM_WEBHOOK_SECRET');
  const miniApp = read('PUBLIC_TMA_URL');
  return {
    token: read('TELEGRAM_BOT_TOKEN'),
    username: read('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '') || null,
    webhookUrl: read('TELEGRAM_WEBHOOK_URL'),
    webhookSecret: secret && SECRET_PATTERN.test(secret) ? secret : null,
    miniAppUrl: miniApp && /^https:\/\//.test(miniApp) ? miniApp : null,
  };
}

/** The bot can link a notification chat: it has a token and a name, and receives messages. */
export function botLinkAvailable(settings: TelegramBotSettings): boolean {
  return !!(settings.token && settings.username && settings.webhookUrl && settings.webhookSecret);
}
