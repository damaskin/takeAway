/**
 * Supported UI languages across all takeAway apps.
 *
 * Default is Russian — the brand is Russian-first and most early users will
 * open the app in a Russian-speaking region. English is the fallback for
 * travellers / staff that prefer it.
 */
export type AppLocale = 'ru' | 'en';

export const DEFAULT_LOCALE: AppLocale = 'ru';

export const AVAILABLE_LOCALES: ReadonlyArray<{ code: AppLocale; label: string; flag: string }> = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];

/** localStorage key under which we persist the user's pick. */
export const LOCALE_STORAGE_KEY = 'takeaway.locale';
