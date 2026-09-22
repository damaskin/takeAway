import type { ConfigService } from '@nestjs/config';

/**
 * The OpenID Connect client id of Telegram Login for this deployment.
 *
 * Telegram uses the bot's numeric id as the client id, and the ID tokens it
 * signs carry that id as their `aud`. By default it is read off
 * `TELEGRAM_BOT_TOKEN` (the part before the colon), so one bot both signs
 * customers in and messages them; `TELEGRAM_LOGIN_CLIENT_ID` overrides it for
 * a deployment that signs in through a different bot. Null disables Telegram
 * Login (the legacy widget and the Mini App keep working on the bot token).
 */
export function telegramLoginClientId(config: ConfigService): string | null {
  const explicit = config.get<string>('TELEGRAM_LOGIN_CLIENT_ID')?.trim();
  if (explicit) return explicit;
  const token = config.get<string>('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
  return /^(\d+):/.exec(token)?.[1] ?? null;
}
