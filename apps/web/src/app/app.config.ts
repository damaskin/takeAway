import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideTakeawayI18n } from '@takeaway/i18n';

import { appRoutes } from './app.routes';
import { API_CONFIG, DEFAULT_API_CONFIG } from './core/api/api.config';
import {
  SOCIAL_AUTH_CONFIG,
  TELEGRAM_AUTH_CONFIG,
  provideSentry,
  resolveSocialAuthConfig,
  resolveSpaSentryConfig,
  resolveTelegramBotUsername,
  resolveTelegramClientId,
  type TelegramAuthConfig,
} from '@takeaway/ui-kit';

import { authInterceptor } from './core/auth/auth.interceptor';
import { registerServiceWorker } from './core/pwa/service-worker';

const telegramConfig: TelegramAuthConfig = {
  botUsername: resolveTelegramBotUsername(),
  clientId: resolveTelegramClientId(),
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      // A new page opens at its top and Back returns to where the customer
      // was — without it a product opened from far down the menu opened
      // scrolled down, and coming back threw them to the top of the menu.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: API_CONFIG, useValue: DEFAULT_API_CONFIG },
    { provide: TELEGRAM_AUTH_CONFIG, useValue: telegramConfig },
    { provide: SOCIAL_AUTH_CONFIG, useValue: resolveSocialAuthConfig() },
    ...provideTakeawayI18n(),
    ...provideSentry(resolveSpaSentryConfig('web')),
    // Unconditional: the offline shell has to exist for everyone, not just
    // the customers who opted into push.
    provideAppInitializer(() => registerServiceWorker()),
  ],
};
