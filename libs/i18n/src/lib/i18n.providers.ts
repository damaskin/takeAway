import { inject, provideAppInitializer } from '@angular/core';
import { TranslateLoader, TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import { AVAILABLE_LOCALES, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, type AppLocale } from './i18n.types';
import { TRANSLATIONS_EN } from './translations/en';
import { TRANSLATIONS_RU } from './translations/ru';

/**
 * In-memory TranslateLoader — our translation bundles are plain TS objects
 * that ship inside the JS bundle. This avoids an HTTP round-trip for ~2-3 KB
 * gzipped per language and keeps the UI responsive even on cold cache /
 * offline Telegram WebApp sessions.
 */
class InlineTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<Translation> {
    const dict = lang === 'en' ? TRANSLATIONS_EN : TRANSLATIONS_RU;
    return of(dict as unknown as Translation);
  }
}

/**
 * Shared i18n setup for every takeAway Angular app. Adds these Angular
 * providers in one call:
 *   - TranslateService with ru/en bundles
 *   - sensible defaults (ru default, browser/localStorage override, en fallback)
 *   - an APP_INITIALIZER that resolves the picked locale BEFORE bootstrap
 *     so the very first paint is already localized.
 */
export function provideTakeawayI18n() {
  return [
    provideTranslateService({
      lang: DEFAULT_LOCALE,
      fallbackLang: 'en',
      // ngx-translate@17 uses the abstract `TranslateLoader` class as the
      // injection token. A string token silently becomes NG0201 at bootstrap
      // and the whole app stays stuck on a blank <app-root>.
      loader: { provide: TranslateLoader, useClass: InlineTranslateLoader },
    }),
    provideAppInitializer(() => {
      const translate = inject(TranslateService);
      const codes = AVAILABLE_LOCALES.map((l) => l.code);
      translate.addLangs(codes);
      translate.setFallbackLang('en');

      const picked = resolveInitialLocale();
      translate.use(picked);
      // Keep <html lang> in sync so screen readers / browser UI pick up
      // the right language.
      if (typeof document !== 'undefined') {
        document.documentElement.lang = picked;
      }
    }),
  ];
}

/**
 * Pick the initial UI language.
 *
 * takeAway is Russian-first: Russian is the default for every user regardless
 * of browser locale. We only bow to the browser when it reports Russian too
 * (so we don't gratuitously ignore a user's explicit system preference when
 * they match ours). Any other browser locale falls back to Russian until the
 * user hits the switcher and stores an explicit choice.
 *
 *   1. explicit user choice saved to localStorage — highest priority,
 *   2. Russian if navigator.language starts with `ru`,
 *   3. otherwise default (Russian).
 */
export function resolveInitialLocale(): AppLocale {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  }
  // Intentionally no auto-fallback to English for non-Russian browsers —
  // Russian stays the default until the user picks English themselves.
  return DEFAULT_LOCALE;
}

/**
 * Imperative language switch used by the language switcher component. Also
 * persists the choice so subsequent reloads keep it.
 */
export function setAppLocale(translate: TranslateService, locale: AppLocale): void {
  translate.use(locale);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}
