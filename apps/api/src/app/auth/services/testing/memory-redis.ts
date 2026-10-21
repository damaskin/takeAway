import type { RedisService } from '../../../redis/redis.service';

interface Entry {
  value: string;
  /** Milliseconds on {@link MemoryRedis}'s own clock; null = no TTL. */
  expiresAt: number | null;
}

/**
 * Test-only, in-memory stand-in for the parts of RedisService the email
 * sign-in codes and the Telegram link codes use — values with TTLs,
 * `SET … EX … NX`, GETDEL, MULTI — on a clock the test moves by hand with
 * {@link advance}.
 */
export class MemoryRedis {
  private readonly entries = new Map<string, Entry>();
  private clockMs = 0;

  advance(seconds: number): void {
    this.clockMs += seconds * 1000;
  }

  /** Every live key with its value, for assertions about what is stored. */
  dump(): Array<[string, string]> {
    return [...this.entries.keys()].flatMap((key) => {
      const entry = this.live(key);
      return entry ? [[key, entry.value] as [string, string]] : [];
    });
  }

  asService(): RedisService {
    return this as unknown as RedisService;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.write(key, value, ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) {
      this.write(key, '1', ttlSeconds);
      return 1;
    }
    const next = Number(entry.value) + 1;
    entry.value = String(next);
    return next;
  }

  readonly raw = {
    set: async (key: string, value: string, ...options: Array<string | number>): Promise<'OK' | null> => {
      let ttl: number | undefined;
      let onlyIfNew = false;
      for (let i = 0; i < options.length; i++) {
        if (options[i] === 'EX') ttl = Number(options[++i]);
        else if (options[i] === 'NX') onlyIfNew = true;
      }
      if (onlyIfNew && this.live(key)) return null;
      this.write(key, value, ttl);
      return 'OK';
    },
    del: async (...keys: string[]): Promise<number> => {
      let removed = 0;
      for (const key of keys) {
        if (this.live(key)) removed++;
        this.entries.delete(key);
      }
      return removed;
    },
    getdel: async (key: string): Promise<string | null> => {
      const entry = this.live(key);
      this.entries.delete(key);
      return entry?.value ?? null;
    },
    ttl: async (key: string): Promise<number> => {
      const entry = this.live(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.ceil((entry.expiresAt - this.clockMs) / 1000);
    },
    multi: () => {
      const queued: Array<() => Promise<unknown>> = [];
      const chain = {
        set: (key: string, value: string, ...options: Array<string | number>) => {
          queued.push(() => this.raw.set(key, value, ...options));
          return chain;
        },
        del: (...keys: string[]) => {
          queued.push(() => this.raw.del(...keys));
          return chain;
        },
        exec: async () => {
          const results: Array<[null, unknown]> = [];
          for (const run of queued) results.push([null, await run()]);
          return results;
        },
      };
      return chain;
    },
  };

  private live(key: string): Entry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.clockMs) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  private write(key: string, value: string, ttlSeconds?: number): void {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? this.clockMs + ttlSeconds * 1000 : null,
    });
  }
}
