import { Component, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { AVAILABLE_LOCALES, type AppLocale } from './i18n.types';
import { setAppLocale } from './i18n.providers';

/**
 * Compact RU/EN toggle that fits inside app top bars. Renders as a pill with
 * two segments; the active locale is filled with var(--color-caramel).
 *
 * Usage:
 *   imports: [LanguageSwitcherComponent]
 *   <app-language-switcher />
 */
@Component({
  selector: 'app-language-switcher',
  standalone: true,
  template: `
    <div
      class="flex items-center"
      style="height: 32px; padding: 2px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 9999px; gap: 2px"
    >
      @for (loc of locales; track loc.code) {
        <button
          type="button"
          (click)="pick(loc.code)"
          class="flex items-center justify-center"
          [style.background]="current() === loc.code ? 'var(--color-caramel)' : 'transparent'"
          [style.color]="current() === loc.code ? 'white' : 'var(--color-text-secondary)'"
          style="height: 26px; padding: 0 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; gap: 4px"
          [attr.aria-pressed]="current() === loc.code"
          [attr.aria-label]="'Switch language to ' + loc.label"
        >
          {{ loc.code }}
        </button>
      }
    </div>
  `,
})
export class LanguageSwitcherComponent {
  private readonly translate = inject(TranslateService);
  readonly locales = AVAILABLE_LOCALES;
  private readonly _current = signal<AppLocale>(this.initial());
  readonly current = computed<AppLocale>(() => this._current());

  constructor() {
    this.translate.onLangChange.subscribe((e) => {
      const lang = e.lang;
      if (lang === 'ru' || lang === 'en') this._current.set(lang);
    });
  }

  pick(code: AppLocale): void {
    if (code === this._current()) return;
    setAppLocale(this.translate, code);
    this._current.set(code);
  }

  private initial(): AppLocale {
    const lang = this.translate.currentLang ?? this.translate.getDefaultLang();
    return lang === 'en' ? 'en' : 'ru';
  }
}
