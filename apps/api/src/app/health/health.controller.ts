import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';

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
}
