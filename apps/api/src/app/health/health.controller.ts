import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
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

interface HealthResponse {
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

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get()
  @Public()
  @ApiOkResponse({ description: 'Service liveness probe + build metadata' })
  check(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.env['BUILD_VERSION'] ?? 'dev',
      commit: process.env['BUILD_COMMIT'] ?? 'unknown',
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
