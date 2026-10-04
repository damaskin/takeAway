import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { PlatformOverviewDto, PlatformOverviewQueryDto } from './dto/overview.dto';
import { OverviewService } from './overview.service';

/**
 * The platform admin's dashboard: every business side by side with the
 * commission it brought in, the period against the one before. `brandId`
 * and `storeId` are ignored here — drilling into one brand is the business
 * dashboard's job.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('admin/platform')
@Roles('SUPER_ADMIN')
export class PlatformOverviewController {
  constructor(private readonly overviews: OverviewService) {}

  @Get('overview')
  @ApiOkResponse({ type: PlatformOverviewDto })
  overview(@Query() query: PlatformOverviewQueryDto): Promise<PlatformOverviewDto> {
    return this.overviews.platform({ from: query.from, to: query.to, days: query.days }, query.currency);
  }
}
