/**
 * Guessing a store's IANA time zone from where it is.
 *
 * Working hours are local wall-clock minutes, so a store left on the UTC
 * placeholder is two or three hours off in Tiraspol and looks closed right
 * after the staff open a shift. Nobody types a zone unprompted, so the API
 * and the admin derive one from the address and the map pin of the region
 * we serve. Offline and deliberately small: a country or city outside the
 * list simply yields no suggestion.
 */

/** The zone of the market we launched in; the last resort for a new store. */
export const DEFAULT_STORE_TIME_ZONE = 'Europe/Chisinau';

export interface StoreLocationHint {
  /** ISO code ('MD') or a name in any of our languages ('Молдова', 'ПМР'). */
  country?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

const CHISINAU = 'Europe/Chisinau';
const KYIV = 'Europe/Kyiv';
const MOSCOW = 'Europe/Moscow';
const BUCHAREST = 'Europe/Bucharest';

/** Country codes and names → zone. Only single-zone countries (and Russia, by its capital). */
const COUNTRY_ZONES: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    CHISINAU,
    [
      'md',
      'moldova',
      'republic of moldova',
      'moldova republic of',
      'молдова',
      'молдавия',
      'республика молдова',
      'pmr',
      'пмр',
      'приднестровье',
      'приднестровская молдавская республика',
      'transnistria',
      'pridnestrovie',
    ],
  ],
  [KYIV, ['ua', 'ukraine', 'украина', 'україна']],
  [MOSCOW, ['ru', 'russia', 'russian federation', 'россия', 'российская федерация', 'рф']],
  [BUCHAREST, ['ro', 'romania', 'румыния']],
  ['Europe/Minsk', ['by', 'belarus', 'беларусь', 'белоруссия']],
  ['Europe/Sofia', ['bg', 'bulgaria', 'болгария']],
  ['Europe/Istanbul', ['tr', 'turkey', 'turkiye', 'турция']],
  ['Asia/Tbilisi', ['ge', 'georgia', 'грузия']],
  ['Asia/Yerevan', ['am', 'armenia', 'армения']],
  ['Asia/Baku', ['az', 'azerbaijan', 'азербайджан']],
  ['Europe/Warsaw', ['pl', 'poland', 'польша']],
  ['Europe/Berlin', ['de', 'germany', 'германия']],
  ['Europe/London', ['gb', 'uk', 'united kingdom', 'великобритания', 'англия']],
  ['Europe/Lisbon', ['pt', 'portugal', 'португалия']],
  ['Asia/Dubai', ['ae', 'uae', 'united arab emirates', 'оаэ', 'эмираты']],
  ['Asia/Bangkok', ['th', 'thailand', 'таиланд', 'тайланд']],
];

/** Cities people type, in Russian, Romanian and English spellings. */
const CITY_ZONES: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    CHISINAU,
    [
      'chisinau',
      'kishinev',
      'кишинев',
      'tiraspol',
      'тирасполь',
      'bender',
      'bendery',
      'бендеры',
      'бендер',
      'tighina',
      'тигина',
      'balti',
      'beltsy',
      'бельцы',
      'ribnita',
      'rybnitsa',
      'rybnita',
      'рыбница',
      'dubasari',
      'dubossary',
      'дубоссары',
      'slobozia',
      'слободзея',
      'grigoriopol',
      'григориополь',
      'dnestrovsk',
      'днестровск',
      'comrat',
      'комрат',
      'cahul',
      'кагул',
      'orhei',
      'оргеев',
      'ungheni',
      'унгены',
      'soroca',
      'сороки',
    ],
  ],
  [KYIV, ['kyiv', 'kiev', 'киев', 'київ', 'odesa', 'odessa', 'одесса', 'одеса', 'lviv', 'львов', 'kharkiv', 'харьков']],
  [MOSCOW, ['moscow', 'москва', 'saint petersburg', 'st petersburg', 'санкт-петербург', 'петербург']],
  [BUCHAREST, ['bucharest', 'bucuresti', 'бухарест', 'iasi', 'яссы']],
];

/**
 * Moldova with Transnistria, roughly. Only consulted when neither the city
 * nor the country is recognised (POS imports leave both as '—'). The box
 * spills a little into Romania and Ukraine, whose clocks match Moldova's
 * all year, so the guess is right there too.
 */
const MOLDOVA_BOX = { minLat: 45.45, maxLat: 48.5, minLng: 26.6, maxLng: 30.15 } as const;

/**
 * The zone a store most likely keeps, or null when nothing about its
 * location is recognised. The city wins over the country (a Transnistrian
 * address may say «ПМР», «MD» or nothing at all), the country over the pin.
 */
export function suggestStoreTimeZone(hint: StoreLocationHint): string | null {
  const city = normalize(hint.city);
  if (city) {
    const zone = lookup(CITY_ZONES, city);
    if (zone) return resolveZone(zone);
  }
  const country = normalize(hint.country);
  if (country) {
    const zone = lookup(COUNTRY_ZONES, country);
    if (zone) return resolveZone(zone);
  }
  if (inBox(hint.latitude, hint.longitude)) return resolveZone(CHISINAU);
  return null;
}

/**
 * True for a zone nobody chose: empty, or the UTC a new or imported store
 * used to get. No café keeps UTC wall-clock time.
 */
export function isUnsetTimeZone(zone: string | null | undefined): boolean {
  if (!zone) return true;
  const z = zone.trim().toUpperCase();
  return z === '' || z === 'UTC' || z === 'ETC/UTC' || z === 'GMT' || z === 'ETC/GMT' || z === 'Z';
}

/** Names go through the same {@link normalize} as the input: 'київ' and 'Київ' both end up 'киів'. */
function lookup(table: ReadonlyArray<readonly [string, readonly string[]]>, key: string): string | null {
  for (const [zone, names] of table) {
    if (names.some((name) => normalize(name) === key)) return zone;
  }
  return null;
}

/** Lower case, no diacritics (Chișinău → chisinau), ё → е, single spaces, no dots. */
function normalize(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,]/g, ' ')
    .replace(/^(г|город|mun|municipiul|or|oras|city of)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inBox(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  if (lat === 0 && lng === 0) return false;
  return (
    lat >= MOLDOVA_BOX.minLat && lat <= MOLDOVA_BOX.maxLat && lng >= MOLDOVA_BOX.minLng && lng <= MOLDOVA_BOX.maxLng
  );
}

/**
 * The spelling this runtime uses: Node and Chrome still call Kyiv
 * 'Europe/Kiev', and a zone the runtime cannot list would not match any
 * option of the admin's picker.
 */
function resolveZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return zone === KYIV ? 'Europe/Kiev' : zone;
  }
}
