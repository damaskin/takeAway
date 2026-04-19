import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideTakeawayI18n } from '@takeaway/i18n';

import { appRoutes } from './app.routes';
import { API_CONFIG, DEFAULT_API_CONFIG } from './core/api/api.config';
import {
  DEFAULT_TELEGRAM_AUTH_CONFIG,
  TELEGRAM_AUTH_CONFIG,
  type TelegramAuthConfig,
} from './core/api/telegram.config';
import { authInterceptor } from './core/auth/auth.interceptor';

// Bot username for the Telegram Login Widget. Sourced from a global the
// host page can set (e.g. `<script>window.__TELEGRAM_BOT_USERNAME = '...'`)
// so staging/prod can swap bots without rebuilding the SPA. If unset the
// widget button hides itself at runtime.
const telegramBotUsername =
  (typeof globalThis !== 'undefined' && (globalThis as { __TELEGRAM_BOT_USERNAME?: string }).__TELEGRAM_BOT_USERNAME) ||
  DEFAULT_TELEGRAM_AUTH_CONFIG.botUsername;

const telegramConfig: TelegramAuthConfig = {
  botUsername: telegramBotUsername,
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: API_CONFIG, useValue: DEFAULT_API_CONFIG },
    { provide: TELEGRAM_AUTH_CONFIG, useValue: telegramConfig },
    ...provideTakeawayI18n(),
  ],
};
