import { createHash } from 'node:crypto';

import { HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../redis/redis.service';
import {
  type AddressSuggestion,
  cityVariants,
  firstPoint,
  type GeocodePoint,
  squash,
  streetPart,
  toSuggestion,
} from './nominatim';

export const DEFAULT_GEOCODER_URL = 'https://nominatim.openstreetmap.org';

/**
 * OSM's usage policy allows at most one request per second from the whole
 * application, not per user. A little over a second leaves room for clock
 * skew between us and them.
 */
export const MIN_INTERVAL_MS = 1100;
/** How long a lookup may wait for its turn before the admin is told to try again. */
const MAX_QUEUE_WAIT_MS = 5000;
const REQUEST_TIMEOUT_MS = 6000;
/** Addresses do not move: a found one is kept two weeks, a miss a day (OSM gets edited). */
const HIT_TTL_SECONDS = 14 * 24 * 3600;
const MISS_TTL_SECONDS = 24 * 3600;
/** After a 429 or 403 the geocoder is left alone for a minute. */
const COOLDOWN_MS = 60_000;

const KEY = 'geocode:v1';
const THROTTLE_KEY = `${KEY}:throttle`;
const COOLDOWN_KEY = `${KEY}:cooldown`;
const ACCEPT_LANGUAGE = 'ru,en';

export interface GeocodeInput {
  address: string;
  city?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
}

export interface GeocodeResult extends GeocodePoint {
  /** Only the city was found, not the street address. */
  approximate: boolean;
}

type Params = Record<string, string>;

/** 503 the admin shows as "address search is unavailable — place the pin by hand". */
function unavailable(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    error: 'Service Unavailable',
    code: 'GEOCODER_UNAVAILABLE',
    message,
  });
}

/**
 * Turns the address typed in the store form into a point on the map, and a
 * point dropped on the map into an address, through a Nominatim-compatible
 * geocoder (`GEOCODER_URL`, OpenStreetMap's public instance by default).
 *
 * The browser never calls the geocoder itself: OSM's policy wants one
 * identifiable application (`GEOCODER_CONTACT` in the User-Agent), at most
 * one request a second across all of it, and repeated questions answered
 * from a cache — all of which only the server can promise. Pacing goes
 * through Redis so it holds across API processes.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly baseUrl: string;
  private readonly userAgent: string;
  /** Used only while Redis is unreachable. */
  private localNextSlotAt = 0;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.baseUrl = (squash(config.get<string>('GEOCODER_URL')) || DEFAULT_GEOCODER_URL).replace(/\/+$/, '');
    const contact =
      squash(config.get<string>('GEOCODER_CONTACT')) || squash(config.get<string>('SUPPORT_EMAIL')) || 'takeaway.md';
    this.userAgent = `takeAway/1.0 (store address lookup; +https://takeaway.md; ${contact})`;
  }

  /**
   * The point for a store's address. Structured search first — free-form
   * search matched «ул. 25 Октября 50, Тирасполь» to a shooting range in
   * Chișinău — then the same with the city in Latin letters, then the city
   * alone, marked `approximate`, so the map can at least open there.
   */
  async locate(input: GeocodeInput): Promise<GeocodeResult | null> {
    const cities = cityVariants(input.city ?? '');
    const street = streetPart(input.address, input.city ?? '');
    const country = squash(input.country).toLowerCase();
    const scope: Params = /^[a-z]{2}$/.test(country) ? { countrycodes: country } : {};

    if (street) {
      for (const city of cities.length > 0 ? cities : [undefined]) {
        const hit = await this.search({ ...scope, street, ...(city ? { city } : {}) });
        if (hit) return { ...hit, approximate: false };
      }
    }
    for (const city of cities) {
      const hit = await this.search({ ...scope, city });
      if (hit) return { ...hit, approximate: true };
    }
    return null;
  }

  /** What address is at a point, to fill the store form when the owner placed the pin first. */
  async suggestAddress(lat: number, lng: number): Promise<AddressSuggestion | null> {
    // ~1 m: pins dropped a hair apart share the answer.
    const params: Params = { lat: lat.toFixed(5), lon: lng.toFixed(5), zoom: '18' };
    return this.cached('reverse', params, async () => toSuggestion(await this.request('/reverse', params)));
  }

  private async search(params: Params): Promise<GeocodePoint | null> {
    return this.cached('search', params, async () =>
      firstPoint(await this.request('/search', { ...params, limit: '3' })),
    );
  }

  /** The answer for `params` from Redis, or computed and remembered. A broken cache only costs speed. */
  private async cached<T extends object>(
    kind: string,
    params: Params,
    load: () => Promise<T | null>,
  ): Promise<T | null> {
    const key = `${KEY}:${kind}:${createHash('sha1').update(stableJson(params)).digest('hex')}`;
    try {
      const stored = await this.redis.get(key);
      if (stored !== null) return JSON.parse(stored) as T | null;
    } catch (error) {
      this.logger.warn(`Geocode cache read failed: ${(error as Error).message}`);
    }
    const value = await load();
    try {
      await this.redis.set(key, JSON.stringify(value), value ? HIT_TTL_SECONDS : MISS_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Geocode cache write failed: ${(error as Error).message}`);
    }
    return value;
  }

  private async request(path: string, params: Params): Promise<unknown> {
    await this.respectCooldown();
    await this.waitForTurn();
    const query = new URLSearchParams({
      ...params,
      format: 'jsonv2',
      addressdetails: '1',
      'accept-language': ACCEPT_LANGUAGE,
    });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}?${query.toString()}`, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Geocoder unreachable: ${(error as Error).message}`);
      throw unavailable('The address search did not answer in time');
    }
    if (response.status === 429 || response.status === 403) {
      // Told to slow down or blocked: stop asking for a while rather than dig deeper.
      await this.startCooldown();
      this.logger.warn(`Geocoder refused with ${response.status}; pausing lookups for ${COOLDOWN_MS / 1000}s`);
      throw unavailable('The address search is busy — try again in a minute');
    }
    if (!response.ok) {
      this.logger.warn(`Geocoder answered ${response.status}`);
      throw unavailable('The address search is unavailable right now');
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw unavailable('The address search sent an unreadable answer');
    }
  }

  /**
   * Waits until this process may send the next request: a Redis key that
   * lives MIN_INTERVAL_MS is the token, whoever sets it goes. Without Redis
   * the pacing is per process, which is still one request a second here.
   */
  private async waitForTurn(): Promise<void> {
    const deadline = Date.now() + MAX_QUEUE_WAIT_MS;
    for (;;) {
      let waitMs: number;
      try {
        const won = await this.redis.raw.set(THROTTLE_KEY, '1', 'PX', MIN_INTERVAL_MS, 'NX');
        if (won === 'OK') return;
        const ttl = await this.redis.raw.pttl(THROTTLE_KEY);
        waitMs = ttl > 0 ? ttl : 20;
      } catch {
        const now = Date.now();
        if (now >= this.localNextSlotAt) {
          this.localNextSlotAt = now + MIN_INTERVAL_MS;
          return;
        }
        waitMs = this.localNextSlotAt - now;
      }
      if (Date.now() + waitMs > deadline) throw unavailable('The address search is busy — try again in a moment');
      await this.sleep(waitMs);
    }
  }

  private async respectCooldown(): Promise<void> {
    let paused = false;
    try {
      paused = (await this.redis.get(COOLDOWN_KEY)) !== null;
    } catch {
      paused = false;
    }
    if (paused) throw unavailable('The address search is busy — try again in a minute');
  }

  private async startCooldown(): Promise<void> {
    try {
      await this.redis.raw.set(COOLDOWN_KEY, '1', 'PX', COOLDOWN_MS);
    } catch {
      // Without Redis there is nothing to remember it in; the per-request pacing still applies.
    }
  }

  /** Separate so tests can skip the wait. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** JSON with sorted keys: the same question always hashes to the same cache key. */
function stableJson(params: Params): string {
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .map((key) => [key, params[key]]),
  );
}
