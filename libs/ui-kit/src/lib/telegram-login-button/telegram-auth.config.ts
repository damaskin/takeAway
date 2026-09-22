import { InjectionToken } from '@angular/core';

export interface TelegramAuthConfig {
  /**
   * The Telegram bot's public `@username` without the `@`. Used by the legacy
   * Login Widget's `data-telegram-login` attribute; it only works for domains
   * registered against this bot via BotFather's `/setdomain` command.
   */
  botUsername: string;

  /**
   * Telegram Login (OpenID Connect) client id — the bot's numeric id. When
   * set, the SPA uses Telegram's current login library and the API verifies
   * an ID token; the site's origin must be in the bot's Allowed URLs
   * (@BotFather mini app → bot → Login Widget). Blank keeps the legacy widget.
   */
  clientId: string;
}

export const TELEGRAM_AUTH_CONFIG = new InjectionToken<TelegramAuthConfig>('TELEGRAM_AUTH_CONFIG');

/**
 * Default is blank so the Telegram button hides itself at runtime if the
 * deployment hasn't configured a bot. To enable, set the values on
 * `window.__TELEGRAM_CLIENT_ID` / `window.__TELEGRAM_BOT_USERNAME` in the
 * host `index.html` (both are public — only the bot token must stay on the
 * server).
 */
export const DEFAULT_TELEGRAM_AUTH_CONFIG: TelegramAuthConfig = {
  botUsername: '',
  clientId: '',
};

/**
 * Reads the bot username from a window-level global so staging/prod can
 * swap bots without rebuilding the SPA. Returns the default (blank) if
 * unset — each app provides `TELEGRAM_AUTH_CONFIG` in its bootstrap.
 */
export function resolveTelegramBotUsername(): string {
  if (typeof globalThis === 'undefined') {
    return DEFAULT_TELEGRAM_AUTH_CONFIG.botUsername;
  }
  const fromGlobal = (globalThis as { __TELEGRAM_BOT_USERNAME?: string }).__TELEGRAM_BOT_USERNAME;
  return fromGlobal || DEFAULT_TELEGRAM_AUTH_CONFIG.botUsername;
}

/** Same as {@link resolveTelegramBotUsername}, for the Telegram Login client id. */
export function resolveTelegramClientId(): string {
  if (typeof globalThis === 'undefined') {
    return DEFAULT_TELEGRAM_AUTH_CONFIG.clientId;
  }
  const fromGlobal = (globalThis as { __TELEGRAM_CLIENT_ID?: string }).__TELEGRAM_CLIENT_ID;
  return fromGlobal ? String(fromGlobal).trim() : DEFAULT_TELEGRAM_AUTH_CONFIG.clientId;
}
