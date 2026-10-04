import { DEFAULT_STORE_TIME_ZONE, isUnsetTimeZone, suggestStoreTimeZone } from './store-time-zone';

/** Node still spells Kyiv the old way; accept whichever this runtime uses. */
const KYIV = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv' }).resolvedOptions().timeZone;

describe('suggestStoreTimeZone', () => {
  it.each([
    ['Тирасполь', null],
    ['г. Тирасполь', ''],
    ['Tiraspol', '—'],
    ['Бендеры', 'ПМР'],
    ['Chișinău', 'MD'],
    ['кишинёв', null],
    ['Bălți', null],
  ])('puts %s (%s) in Moldova', (city, country) => {
    expect(suggestStoreTimeZone({ city, country })).toBe('Europe/Chisinau');
  });

  it.each([
    ['MD', 'Europe/Chisinau'],
    ['md', 'Europe/Chisinau'],
    ['Молдова', 'Europe/Chisinau'],
    ['Приднестровье', 'Europe/Chisinau'],
    ['UA', KYIV],
    ['Україна', KYIV],
    ['RU', 'Europe/Moscow'],
    ['RO', 'Europe/Bucharest'],
    ['AE', 'Asia/Dubai'],
  ])('maps the country %s to %s', (country, zone) => {
    expect(suggestStoreTimeZone({ country, city: 'Somewhere' })).toBe(zone);
  });

  it('prefers the city to the country', () => {
    expect(suggestStoreTimeZone({ city: 'Одесса', country: 'MD' })).toBe(KYIV);
  });

  it('falls back to the map pin inside Moldova and Transnistria', () => {
    expect(suggestStoreTimeZone({ city: '—', country: '—', latitude: 46.8403, longitude: 29.6433 })).toBe(
      'Europe/Chisinau',
    );
  });

  it('suggests nothing it cannot place', () => {
    expect(suggestStoreTimeZone({ city: 'Springfield', country: 'US', latitude: 39.8, longitude: -89.6 })).toBeNull();
    expect(suggestStoreTimeZone({ latitude: 0, longitude: 0 })).toBeNull();
    expect(suggestStoreTimeZone({})).toBeNull();
  });

  it('never suggests UTC', () => {
    expect(DEFAULT_STORE_TIME_ZONE).toBe('Europe/Chisinau');
  });
});

describe('isUnsetTimeZone', () => {
  it.each(['', null, undefined, 'UTC', 'Etc/UTC', 'utc', 'GMT'])('treats %p as not chosen', (zone) => {
    expect(isUnsetTimeZone(zone)).toBe(true);
  });

  it('accepts a real zone', () => {
    expect(isUnsetTimeZone('Europe/Chisinau')).toBe(false);
  });
});
