import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideTakeawayI18n } from '@takeaway/i18n';

import { appRoutes } from './app.routes';
import { API_CONFIG, DEFAULT_API_CONFIG } from './core/api/api.config';
import { authInterceptor } from './core/auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: API_CONFIG, useValue: DEFAULT_API_CONFIG },
    ...provideTakeawayI18n(),
  ],
};
