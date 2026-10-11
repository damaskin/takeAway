import { createHash, timingSafeEqual } from 'node:crypto';

import { Controller, Get, Headers, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ReadinessService, type ReadinessReport } from './readiness.service';

/**
 * Just the slice of the Fastify reply we touch. `fastify` is a transitive
 * dependency of @nestjs/platform-fastify, not a declared one, so importing
 * its types directly would not resolve under pnpm's strict layout.
 */
interface StatusReply {
  status(code: number): unknown;
}

/** What anyone gets: alive, and which build — no more than the deploy gate needs. */
interface PublicHealth {
  status: 'ok';
  /**
   * The first {@link SHORT_COMMIT_LENGTH} characters of the commit the
   * container was built from. deploy/scripts/smoke-test.sh compares it with
   * the commit it just deployed.
   */
  commit: string;
}

/** With a valid `X-Health-Token` (`HEALTH_TOKEN`): the full build triple and uptime. */
interface DetailedHealth {
  status: 'ok';
  uptime: number;
  timestamp: string;
  /** Human-readable version, e.g. `v0.5.0-13-ga072a5f` from `git describe`. */
  version: string;
  /** Full commit SHA the running container was built from. */
  commit: string;
  /** ISO-8601 build timestamp (UTC), stamped by deploy.sh. */
  builtAt: string;
}

export const SHORT_COMMIT_LENGTH = 12;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  /**
   * Liveness. Public, so it says only that the process answers and a short
   * commit. The version, build time and uptime used to be public as well — a
   * free fingerprint of exactly which release (and when it last restarted)
   * anyone probing the API was looking at; they now need `X-Health-Token`.
   */
  @Get()
  @Public()
  @ApiOkResponse({ description: 'Liveness probe + short commit; full build metadata with X-Health-Token' })
  check(@Headers('x-health-token') token?: string): PublicHealth | DetailedHealth {
    const commit = process.env['BUILD_COMMIT'] ?? 'unknown';
    if (!healthTokenMatches(token, process.env['HEALTH_TOKEN'])) {
      return { status: 'ok', commit: commit.slice(0, SHORT_COMMIT_LENGTH) };
    }
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.env['BUILD_VERSION'] ?? 'dev',
      commit,
      builtAt: process.env['BUILD_TIME'] ?? 'unknown',
    };
  }

  /**
   * Can we actually serve an order? Unlike `/health`, this talks to
   * Postgres and Redis and answers 503 when either is down, so a deploy
   * gate or an orchestrator has something real to wait on.
   */
  @Get('ready')
  @Public()
  @ApiOkResponse({ description: 'Every dependency answered' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is down' })
  async ready(@Res({ passthrough: true }) reply: StatusReply): Promise<ReadinessReport> {
    const report = await this.readiness.check();
    reply.status(report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}

/** Constant-time, and never true while no token is configured. */
function healthTokenMatches(given: string | undefined, expected: string | undefined): boolean {
  const want = expected?.trim();
  if (!want || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}
