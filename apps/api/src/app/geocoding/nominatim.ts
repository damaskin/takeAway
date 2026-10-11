/**
 * Talking to a Nominatim-compatible geocoder (OpenStreetMap's public
 * instance by default): the request parameters we send and the parts of the
 * answer we read. Pure functions — the service owns HTTP, cache and pacing.
 */

/** The fields of a Nominatim place we use (`format=jsonv2`, `addressdetails=1`). */
export interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
}

/** A point we found, ready for the admin's map. */
export interface GeocodePoint {
  lat: number;
  lng: number;
  /** Short and readable: "Покровская улица, 50, Тирасполь, Молдова". */
  displayName: string;
}

/** What a reverse lookup suggests for the store form's address fields. */
export interface AddressSuggestion extends GeocodePoint {
  addressLine: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
}

const LOCALITY_KEYS = ['city', 'town', 'village', 'hamlet', 'municipality'] as const;
const STREET_KEYS = ['road', 'pedestrian', 'footway', 'square', 'place'] as const;

// prettier-ignore
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // Ukrainian and Moldovan Cyrillic letters.
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ӂ: 'j',
};

/** Collapses runs of whitespace and trims; empty stays empty. */
export function squash(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Russian (and Moldovan Cyrillic) letters spelled in Latin: "Тирасполь" →
 * "Tiraspol". OSM indexes Transnistrian places unevenly — Tiraspol's
 * boundary is «Тираспол», and a search for «Тирасполь» alone found nothing
 * when we tried — so the Latin spelling is the second try for a city typed
 * in Cyrillic.
 */
export function transliterate(value: string): string {
  let out = '';
  for (const char of value) {
    const lower = char.toLowerCase();
    const latin = CYRILLIC_TO_LATIN[lower];
    if (latin === undefined) {
      out += char;
    } else {
      out += char !== lower ? latin.charAt(0).toUpperCase() + latin.slice(1) : latin;
    }
  }
  return out;
}

/** The city as typed and, when it is written in Cyrillic, in Latin as well. */
export function cityVariants(city: string): string[] {
  const typed = squash(city);
  if (!typed) return [];
  const latin = transliterate(typed);
  return latin !== typed ? [typed, latin] : [typed];
}

/**
 * The street part of what the owner typed, without a trailing city they
 * repeated there ("ул. 25 Октября 50, Тирасполь" with city «Тирасполь»).
 */
export function streetPart(address: string, city: string): string {
  const street = squash(address);
  const town = squash(city);
  if (!town) return street;
  const parts = street.split(',').map((p) => p.trim());
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last && last.toLowerCase() === town.toLowerCase()) parts.pop();
  return parts.join(', ');
}

function firstOf(address: Record<string, string | undefined>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = squash(address[key]);
    if (value) return value;
  }
  return null;
}

/** "Покровская улица, 50" — street and house number, or whichever exists. */
function streetLine(address: Record<string, string | undefined>): string | null {
  const street = firstOf(address, STREET_KEYS);
  const house = squash(address['house_number']);
  if (street && house) return `${street}, ${house}`;
  return street;
}

/**
 * A readable name for a place: street with house number, locality, country.
 * Nominatim's own `display_name` lists every administrative level down to
 * «Административно-территориальные единицы левобережья Днестра», which does
 * not fit in a hint line; it is the fallback, cut to its first four parts.
 */
export function shortName(place: NominatimPlace): string {
  const address = place.address ?? {};
  const parts = [streetLine(address), firstOf(address, LOCALITY_KEYS), squash(address['country']) || null].filter(
    (p): p is string => !!p,
  );
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  if (unique.length >= 2) return unique.join(', ');
  return (place.display_name ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(', ');
}

/** The first usable place of a search answer, or null. */
export function firstPoint(answer: unknown): GeocodePoint | null {
  if (!Array.isArray(answer)) return null;
  for (const item of answer as NominatimPlace[]) {
    const point = toPoint(item);
    if (point) return point;
  }
  return null;
}

function toPoint(place: NominatimPlace | null | undefined): GeocodePoint | null {
  if (!place || typeof place !== 'object') return null;
  const lat = Number(place.lat);
  const lng = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, displayName: shortName(place) };
}

/** A reverse answer as suggestions for the store form; null for "nothing here". */
export function toSuggestion(answer: unknown): AddressSuggestion | null {
  if (!answer || typeof answer !== 'object' || 'error' in answer) return null;
  const place = answer as NominatimPlace;
  const point = toPoint(place);
  if (!point) return null;
  const address = place.address ?? {};
  const country = squash(address['country_code']).toUpperCase();
  return {
    ...point,
    addressLine: streetLine(address),
    city: firstOf(address, LOCALITY_KEYS),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}
