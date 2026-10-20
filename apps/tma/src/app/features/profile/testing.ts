import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type Type, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { AuthUser } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

export const TEST_USER: AuthUser = {
  id: 'u-1',
  phone: null,
  email: 'max@example.com',
  name: 'Максим Петров',
  locale: 'RU',
  currency: 'USD',
  role: 'CUSTOMER',
  telegramUserId: '42',
};

/**
 * A profile sub-screen with a signed-in customer, Russian texts, a mocked
 * API and a Telegram back button the test can press. Test-only; no jest
 * globals here, since the app's tsconfig sees this file too.
 */
export async function openProfileScreen<T>(component: Type<T>) {
  const user = signal<AuthUser | null>(TEST_USER);
  let back: (() => void) | null = null;
  let detached = false;
  const detach = (): void => {
    detached = true;
  };
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService({ fallbackLang: 'ru' }),
      { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      {
        provide: TmaAuthStore,
        useValue: { user, isAuthenticated: signal(true), setUser: (next: AuthUser) => user.set(next) },
      },
      {
        provide: TelegramBridgeService,
        useValue: {
          haptic: () => undefined,
          telegramUser: { name: 'Максим Петров', username: 'maxim' },
          setBackButton: (handler: () => void) => {
            back = handler;
            return detach;
          },
        },
      },
    ],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  const http = TestBed.inject(HttpTestingController);
  const fixture: ComponentFixture<T> = TestBed.createComponent(component);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, http, el, user, back: () => back?.(), detached: () => detached };
}
