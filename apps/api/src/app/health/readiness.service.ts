import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** A dependency check must answer inside this, or it counts as down. */
const PROBE_TIMEOUT_MS = 2_000;

export type DependencyState = 'up' | 'down';

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, { status: DependencyState; latencyMs: number; error?: string }>;
}

/**
 * Does the API actually work, as opposed to merely being alive?
 *
 * `/health` answers "the process is running" and nothing more — it stayed
 * green with Postgres face-down, which meant the deploy workflow's health
 * gate would wave through a release that could not serve a single order.
 * This one talks to every dependency the order path needs.
 *
 * Each probe is capped: a hung connection must report "down" quickly rather
 * than making the readiness endpoint hang in turn, because an orchestrator
 * waiting on us is an orchestrator that cannot restart us.
 */
@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<ReadinessReport> {
    const [postgres, redis] = await Promise.all([
      this.probe('postgres', () => this.prisma.$queryRaw`SELECT 1`),
      this.probe('redis', () => this.redis.raw.ping()),
    ]);

    const checks = { postgres, redis };
    return {
      ready: Object.values(checks).every((c) => c.status === 'up'),
      checks,
    };
  }

  private async probe(
    name: string,
    run: () => Promise<unknown>,
  ): Promise<{ status: DependencyState; latencyMs: number; error?: string }> {
    const startedAt = Date.now();
    try {
      await withTimeout(run(), PROBE_TIMEOUT_MS, `${name} probe timed out after ${PROBE_TIMEOUT_MS}ms`);
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (err) {
      const error = (err as Error)?.message ?? String(err);
      this.logger.error(`Readiness probe "${name}" failed: ${error}`);
      return { status: 'down', latencyMs: Date.now() - startedAt, error };
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
