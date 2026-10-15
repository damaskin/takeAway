import { TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { LocaleFormatService, TRANSLATIONS_RU, asapBlockedText, pickupDayLabel, storeHoursText } from '@takeaway/i18n';
import { TRANSLATIONS_EN } from '@takeaway/i18n/en';

/**
 * The hours lines both the site and the Mini App show (libs/i18n
 * store-hours.ts), against the real Russian and English bundles.
 */
describe('store hours lines', () => {
  let translate: TranslateService;
  let fmt: LocaleFormatService;

  // 01:00 on Thursday 15 October in Tiraspol (UTC+3).
  const night = new Date('2026-10-14T22:00:00Z');
  // 22:30 on Wednesday 14 October in Tiraspol.
  const evening = new Date('2026-10-14T19:30:00Z');
  const store = { status: 'OPEN', timezone: 'Europe/Chisinau' };
  const closed = {
    ...store,
    acceptingOrders: true,
    openNow: false,
    asapBlockedReason: 'OUTSIDE_HOURS',
    opensAt: '2026-10-15T06:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService({ fallbackLang: 'ru' })] });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.setTranslation('en', TRANSLATIONS_EN as unknown as Translation);
    translate.use('ru');
    fmt = TestBed.inject(LocaleFormatService);
  });

  it('names the opening time on the store clock while it takes pre-orders only', () => {
    expect(storeHoursText(closed, translate, fmt, night)).toBe(
      'Сейчас закрыто · откроется в 09:00 · можно заказать ко времени',
    );
    expect(storeHoursText(closed, translate, fmt, evening)).toBe(
      'Сейчас закрыто · откроется завтра в 09:00 · можно заказать ко времени',
    );
    expect(storeHoursText({ ...closed, opensAt: '2026-10-16T06:00:00Z' }, translate, fmt, evening)).toBe(
      'Сейчас закрыто · откроется 16 окт. в 09:00 · можно заказать ко времени',
    );
  });

  it('offers pre-orders when the queue is full or the shift has not started', () => {
    expect(storeHoursText({ ...closed, asapBlockedReason: 'QUEUE_FULL' }, translate, fmt, night)).toBe(
      'Большая очередь — только ко времени',
    );
    expect(storeHoursText({ ...closed, asapBlockedReason: 'SHIFT_CLOSED', opensAt: null }, translate, fmt, night)).toBe(
      'Сейчас закрыто · можно заказать ко времени',
    );
  });

  it('says until when while open, and nothing for a store that takes no orders', () => {
    const open = { ...store, acceptingOrders: true, openNow: true, closesAt: '2026-10-15T18:00:00Z' };
    expect(storeHoursText(open, translate, fmt, night)).toBe('до 21:00');
    expect(storeHoursText({ ...closed, acceptingOrders: false }, translate, fmt, night)).toBeNull();
    // An API that predates the fields: as before, nothing extra.
    expect(storeHoursText({ status: 'OPEN', openNow: true }, translate, fmt, night)).toBeNull();
  });

  it('explains at checkout why «Сейчас» is off', () => {
    expect(asapBlockedText(closed, translate, fmt, evening)).toBe(
      'Точка откроется завтра в 09:00 — выберите, к какому времени приготовить заказ.',
    );
    expect(asapBlockedText({ ...closed, asapBlockedReason: 'SHIFT_CLOSED' }, translate, fmt, night)).toBe(
      'Точка ещё не начала работу — выберите, к какому времени приготовить заказ.',
    );
    expect(asapBlockedText({ ...closed, asapBlockedReason: 'QUEUE_FULL' }, translate, fmt, night)).toBe(
      'Сейчас большая очередь — выберите, к какому времени приготовить заказ.',
    );
    expect(asapBlockedText({ ...closed, asapBlockedReason: null }, translate, fmt, night)).toBeNull();
    expect(asapBlockedText({ ...closed, openNow: true }, translate, fmt, night)).toBeNull();
  });

  it('heads pickup windows «Сегодня» and «Завтра», in English too', () => {
    expect(pickupDayLabel(0, '2026-10-15T06:00:00Z', translate, fmt, 'Europe/Chisinau')).toBe('Сегодня');
    expect(pickupDayLabel(1, '2026-10-15T06:00:00Z', translate, fmt, 'Europe/Chisinau')).toBe('Завтра');
    translate.use('en');
    expect(pickupDayLabel(1, '2026-10-15T06:00:00Z', translate, fmt, 'Europe/Chisinau')).toBe('Tomorrow');
    // ICU puts a narrow no-break space before AM.
    expect(storeHoursText(closed, translate, fmt, evening)).toMatch(
      /^Closed now · opens tomorrow at 9:00\sAM · order ahead$/,
    );
  });
});
