import { InjectionToken } from '@angular/core';

export interface TelegramAuthConfig {
  /**
   * The Telegram bot's public `@username` without the `@`. Required by the
   * Login Widget's `data-telegram-login` attribute; the widget only works
   * for domains that were registered against this bot via BotFather's
   * `/setdomain` command.
   */
  botUsername: string;
}

export const TELEGRAM_AUTH_CONFIG = new InjectionToken<TelegramAuthConfig>('TELEGRAM_AUTH_CONFIG');

/**
 * Default is blank so the Login Widget button hides itself at runtime if
 * the deployment hasn't configured a bot. To enable, set the bot username
 * on `window.__TELEGRAM_BOT_USERNAME` in the host `index.html` (the value
 * is public — only the bot token must stay on the server).
 */
export const DEFAULT_TELEGRAM_AUTH_CONFIG: TelegramAuthConfig = {
  botUsername: '',
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
