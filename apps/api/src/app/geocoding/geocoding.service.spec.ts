import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { RedisService } from '../redis/redis.service';
import { GeocodingService, MIN_INTERVAL_MS } from './geocoding.service';
import { cityVariants, shortName, streetPart, toSuggestion, transliterate } from './nominatim';

/** What OSM answers for «ул. 25 Октября 50» in Tiraspol (the street is Покровская now; the old name still matches). */
const POKROVSKAYA_50 = {
  lat: '46.8354554',
  lon: '29.6098413',
  display_name:
    '50, Покровская улица, Площадь Суворова, Красные Казармы, Тирасполь, Тираспольский городской совет, ' +
    'Административно-территориальные единицы левобережья Днестра, Приднестровье, MD-3300, Молдова',
  address: {
    house_number: '50',
    road: 'Покровская улица',
    suburb: 'Красные Казармы',
    city: 'Тирасполь',
    country: 'Молдова',
    country_code: 'md',
  },
};

const TIRASPOL = {
  lat: '46.8566229',
  lon: '29.6059359',
  display_name: 'Тирасполь, Тираспольский городской совет, Приднестровье, MD-3300, Молдова',
  address: { city: 'Тирасполь', country: 'Молдова', country_code: 'md' },
};

let now = 1_000_000;

/** Enough of Redis for the cache and the pacing token, on the test clock. */
function fakeRedis() {
  const data = new Map<string, { value: string; expiresAt: number | null }>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now) data.delete(key);
    return data.get(key);
  };
  return {
    data,
    get: jest.fn(async (key: string) => live(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, ttlSeconds?: number) => {
      data.set(key, { value, expiresAt: ttlSeconds ? now + ttlSeconds * 1000 : null });
    }),
    raw: {
      set: jest.fn(async (key: string, value: string, _px: 'PX', ms: number, nx?: 'NX') => {
        if (nx && live(key)) return null;
        data.set(key, { value, expiresAt: now + ms });
        return 'OK';
      }),
      pttl: jest.fn(async (key: string) => {
        const entry = live(key);
        if (!entry) return -2;
        return entry.expiresAt === null ? -1 : entry.expiresAt - now;
      }),
    },
  };
}

class TestGeocoding extends GeocodingService {
  readonly waits: number[] = [];

  protected override async sleep(ms: number): Promise<void> {
    this.waits.push(ms);
    now += ms;
  }
}

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('GeocodingService', () => {
  let fetchMock: jest.SpyInstance;
  let answers: Array<unknown | ((url: URL) => Response)>;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    answers = [];
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      // Each request takes 200 ms on the test clock.
      now += 200;
      const next = answers.shift();
      if (typeof next === 'function') return (next as (url: URL) => Response)(url);
      return new Response(JSON.stringify(next ?? []), { status: 200 });
    });
  });

  afterEach(() => jest.restoreAllMocks());

  function build(values: Record<string, string> = { SUPPORT_EMAIL: 'hello@takeaway.md' }) {
    const redis = fakeRedis();
    const service = new TestGeocoding(config(values), redis as unknown as RedisService);
    return { service, redis };
  }

  function requested(call: number): URL {
    const args = fetchMock.mock.calls[call] as [string, RequestInit] | undefined;
    if (!args) throw new Error(`expected request #${call}`);
    return new URL(args[0]);
  }

  async function refusal(promise: Promise<unknown>): Promise<Record<string, unknown>> {
    const error = await promise.then(
      () => {
        throw new Error('expected a refusal');
      },
      (e: unknown) => e,
    );
    expect((error as HttpException).getStatus()).toBe(503);
    return (error as HttpException).getResponse() as Record<string, unknown>;
  }

  it('asks OSM a structured question, inside the store country, in Russian, as an identified app', async () => {
    const { service } = build();
    answers.push([POKROVSKAYA_50]);
    const result = await service.locate({ address: 'ул. 25 Октября 50', city: 'Tiraspol', country: 'MD' });

    expect(result).toEqual({
      lat: 46.8354554,
      lng: 29.6098413,
      displayName: 'Покровская улица, 50, Тирасполь, Молдова',
      approximate: false,
    });
    const url = requested(0);
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      street: 'ул. 25 Октября 50',
      city: 'Tiraspol',
      countrycodes: 'md',
      limit: '3',
      format: 'jsonv2',
      addressdetails: '1',
      'accept-language': 'ru,en',
    });
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('hello@takeaway.md');
  });

  it('tries a Cyrillic city again in Latin letters when it finds nothing, waiting its turn', async () => {
    const { service } = build();
    answers.push([], [POKROVSKAYA_50]);
    const result = await service.locate({ address: 'ул. 25 Октября 50', city: 'Тирасполь', country: 'md' });

    expect(result?.approximate).toBe(false);
    expect(requested(0).searchParams.get('city')).toBe('Тирасполь');
    expect(requested(1).searchParams.get('city')).toBe('Tiraspol');
    // One request a second for the whole app: the second one waited out the first one's token.
    expect(service.waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 200);
  });

  it('falls back to the city alone, marked approximate, when the street is not on the map', async () => {
    const { service } = build();
    answers.push([], [], [TIRASPOL]);
    const result = await service.locate({ address: 'ул. Несуществующая 1', city: 'Тирасполь' });

    expect(result).toEqual(expect.objectContaining({ lat: 46.8566229, approximate: true }));
    expect(Object.fromEntries(requested(2).searchParams)).toEqual(expect.objectContaining({ city: 'Тирасполь' }));
    expect(requested(2).searchParams.has('street')).toBe(false);
  });

  it('answers a repeated question from the cache, misses included', async () => {
    const { service } = build();
    answers.push([POKROVSKAYA_50]);
    await service.locate({ address: 'ул. 25 Октября 50', city: 'Tiraspol', country: 'MD' });
    const again = await service.locate({ address: ' ул. 25  Октября 50 ', city: 'Tiraspol', country: 'md' });
    expect(again?.lat).toBe(46.8354554);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answers.push([]);
    expect(await service.locate({ address: 'Nowhere 1' })).toBeNull();
    expect(await service.locate({ address: 'Nowhere 1' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the configured geocoder and contact', async () => {
    const { service } = build({
      GEOCODER_URL: 'https://geo.example.org/nominatim/',
      GEOCODER_CONTACT: 'ops@example.org',
    });
    answers.push([POKROVSKAYA_50]);
    await service.locate({ address: 'Main St 1' });
    expect(requested(0).href.startsWith('https://geo.example.org/nominatim/search?')).toBe(true);
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('ops@example.org');
  });

  it('says the search is unavailable when the geocoder times out or fails', async () => {
    const { service } = build();
    answers.push(() => {
      throw new Error('The operation was aborted due to timeout');
    });
    expect(await refusal(service.locate({ address: 'A 1' }))).toEqual(
      expect.objectContaining({ code: 'GEOCODER_UNAVAILABLE' }),
    );

    answers.push(() => new Response('oops', { status: 502 }));
    expect(await refusal(service.locate({ address: 'B 2' }))).toEqual(
      expect.objectContaining({ code: 'GEOCODER_UNAVAILABLE' }),
    );

    answers.push(() => new Response('<html>', { status: 200 }));
    expect(await refusal(service.locate({ address: 'C 3' }))).toEqual(
      expect.objectContaining({ code: 'GEOCODER_UNAVAILABLE' }),
    );
  });

  it('stops asking for a minute after OSM says too many requests', async () => {
    const { service } = build();
    answers.push(() => new Response('slow down', { status: 429 }));
    await refusal(service.locate({ address: 'A 1' }));
    await refusal(service.locate({ address: 'B 2' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 61_000;
    answers.push([POKROVSKAYA_50]);
    expect(await service.locate({ address: 'B 2' })).not.toBeNull();
  });

  it('gives up waiting when too many lookups queue up, instead of hanging the form', async () => {
    const { service, redis } = build();
    // Someone else holds the token and keeps renewing it.
    redis.raw.set.mockResolvedValue(null);
    redis.raw.pttl.mockResolvedValue(MIN_INTERVAL_MS);
    expect(await refusal(service.locate({ address: 'A 1' }))).toEqual(
      expect.objectContaining({ code: 'GEOCODER_UNAVAILABLE' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still works, one request a second, while Redis is down', async () => {
    const { service, redis } = build();
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    redis.get.mockImplementation(down);
    redis.set.mockImplementation(down);
    redis.raw.set.mockImplementation(down);
    answers.push([POKROVSKAYA_50], [POKROVSKAYA_50]);
    expect(await service.locate({ address: 'A 1' })).not.toBeNull();
    expect(await service.locate({ address: 'B 2' })).not.toBeNull();
    expect(service.waits.length).toBeGreaterThan(0);
  });

  it('suggests the address at a dropped pin, and nothing where OSM has none', async () => {
    const { service } = build();
    answers.push(POKROVSKAYA_50);
    expect(await service.suggestAddress(46.835455, 29.609841)).toEqual({
      lat: 46.8354554,
      lng: 29.6098413,
      displayName: 'Покровская улица, 50, Тирасполь, Молдова',
      addressLine: 'Покровская улица, 50',
      city: 'Тирасполь',
      country: 'MD',
    });
    const url = requested(0);
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('lat')).toBe('46.83546');

    answers.push({ error: 'Unable to geocode' });
    expect(await service.suggestAddress(0.5, -30.25)).toBeNull();
  });
});

describe('nominatim helpers', () => {
  it('spells Cyrillic place names in Latin letters', () => {
    expect(transliterate('Тирасполь')).toBe('Tiraspol');
    expect(transliterate('Бендеры')).toBe('Bendery');
    expect(transliterate('Шёлковая ул. 12')).toBe('Shelkovaya ul. 12');
    expect(cityVariants('Tiraspol')).toEqual(['Tiraspol']);
    expect(cityVariants(' Тирасполь ')).toEqual(['Тирасполь', 'Tiraspol']);
    expect(cityVariants('')).toEqual([]);
  });

  it('drops a city repeated at the end of the street', () => {
    expect(streetPart('ул. 25 Октября 50, Тирасполь', 'тирасполь')).toBe('ул. 25 Октября 50');
    expect(streetPart('ул. 25 Октября, 50', 'Тирасполь')).toBe('ул. 25 Октября, 50');
    expect(streetPart('  Marina   Walk ', '')).toBe('Marina Walk');
  });

  it("keeps a found place's name short, falling back to the start of OSM's own", () => {
    expect(shortName({ lat: '0', lon: '0', display_name: 'Dubai Mall, Downtown, Dubai, Dubai, UAE, Earth' })).toBe(
      'Dubai Mall, Downtown, Dubai, Dubai',
    );
    expect(
      shortName({ lat: '0', lon: '0', address: { road: 'Baker Street', town: 'London', country: 'United Kingdom' } }),
    ).toBe('Baker Street, London, United Kingdom');
  });

  it('reads no suggestion from an answer without a usable point', () => {
    expect(toSuggestion(null)).toBeNull();
    expect(toSuggestion({ lat: 'x', lon: '1' })).toBeNull();
    expect(toSuggestion({ lat: '1', lon: '2', address: { country_code: 'gb' } })).toEqual(
      expect.objectContaining({ country: 'GB', addressLine: null, city: null }),
    );
  });
});
