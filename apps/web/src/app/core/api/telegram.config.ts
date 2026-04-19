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
 * the deployment hasn't configured a bot. To enable, set WEB_TELEGRAM_BOT_USERNAME
 * at build time (or wire a per-env config file) and thread the value into
 * the token in `app.config.ts`.
 */
export const DEFAULT_TELEGRAM_AUTH_CONFIG: TelegramAuthConfig = {
  botUsername: '',
};
