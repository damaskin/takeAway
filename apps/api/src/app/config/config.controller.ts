import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator';
import { FeatureFlagsService } from './feature-flags.service';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /**
   * Runtime feature snapshot. Public — it only carries ops-level
   * booleans (nothing user-specific), and every client fetches it on
   * start to know which modules to render.
   */
  @Get('features')
  @Public()
  @ApiOkResponse({ description: 'Active feature flags for this deployment' })
  features(): { deliveryEnabled: boolean } {
    return this.flags.snapshot();
  }
}
