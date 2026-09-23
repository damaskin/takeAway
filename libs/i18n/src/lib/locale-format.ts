import { Injectable, Pipe, inject, signal, type PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatMoney,
  formatPercent,
  formatShortDay,
  formatTime,
  type DateInput,
  type FormatMoneyOptions,
  type FormatPercentOptions,
} from '@takeaway/utils';

import { DEFAULT_LOCALE, type AppLocale } from './i18n.types';

/**
 * Money, dates and times in the UI language, for every takeAway app.
 *
 * The language is a signal: a template that renders `fmt.money(...)` — or a
 * component method that calls it — is re-rendered when the language switcher
 * flips it, with no subscription of its own.
 */
@Injectable({ providedIn: 'root' })
export class LocaleFormatService {
  private readonly translate = inject(TranslateService);
  private readonly current = signal<AppLocale>(toAppLocale(this.translate.getCurrentLang()));

  /** The UI language; Russian until the viewer picks English. */
  readonly lang = this.current.asReadonly();

  constructor() {
    this.translate.onLangChange.subscribe((e) => this.current.set(toAppLocale(e.lang)));
  }

  /** "38 MDL", "4,50 $", "33 руб." — see `formatMoney`. */
  money(cents: number, currency: string | null | undefined, options?: FormatMoneyOptions): string {
    return formatMoney(cents, currency, this.lang(), options);
  }

  /** "09:00". Pass the store's zone for anything that happens at the store. */
  time(value: DateInput, timeZone?: string | null): string {
    return formatTime(value, this.lang(), timeZone);
  }

  /** «23 сент. 2026». */
  date(value: DateInput, timeZone?: string | null): string {
    return formatDate(value, this.lang(), timeZone);
  }

  /** «23 сент. 2026, 05:33». */
  dateTime(value: DateInput, timeZone?: string | null): string {
    return formatDateTime(value, this.lang(), timeZone);
  }

  /** «23 сент.». */
  dayMonth(value: DateInput, timeZone?: string | null): string {
    return formatDayMonth(value, this.lang(), timeZone);
  }

  /** «23.09» — chart axes. */
  shortDay(value: DateInput, timeZone?: string | null): string {
    return formatShortDay(value, this.lang(), timeZone);
  }

  /** «12,5 %»; with `signed`, «+12,5 %». */
  percent(value: number, options?: FormatPercentOptions): string {
    return formatPercent(value, this.lang(), options);
  }
}

/**
 * `{{ cents | money: currency }}`. Impure so that it follows the language
 * switcher; the formatters behind it are cached, so re-running is cheap.
 */
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly fmt = inject(LocaleFormatService);

  transform(
    cents: number | null | undefined,
    currency: string | null | undefined,
    options?: FormatMoneyOptions,
  ): string {
    return cents == null ? '' : this.fmt.money(cents, currency, options);
  }
}

export type LocalDateStyle = 'time' | 'date' | 'dateTime' | 'dayMonth' | 'shortDay';

/**
 * `{{ iso | localDate: 'dateTime' : store.timezone }}` — Angular's `date`
 * pipe formats in the build's locale, which is English. Impure for the same
 * reason as `money`.
 */
@Pipe({ name: 'localDate', pure: false })
export class LocalDatePipe implements PipeTransform {
  private readonly fmt = inject(LocaleFormatService);

  transform(value: DateInput | null | undefined, style: LocalDateStyle = 'dateTime', timeZone?: string | null): string {
    if (value == null || value === '') return '';
    return this.fmt[style](value, timeZone);
  }
}

function toAppLocale(lang: string | null | undefined): AppLocale {
  return lang === 'en' ? 'en' : lang === 'ru' ? 'ru' : DEFAULT_LOCALE;
}
