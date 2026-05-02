import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ApplyReferralDto, ReferralSummaryDto } from './dto/referrals.dto';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals')
@ApiBearerAuth()
@Controller()
export class ReferralsController {
  constructor(private readonly service: ReferralsService) {}

  @Get('me/referrals')
  @ApiOkResponse({ type: ReferralSummaryDto })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<ReferralSummaryDto> {
    return this.service.getMine(user.id);
  }

  @Post('me/referrals/apply')
  @ApiOkResponse({ type: ReferralSummaryDto })
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyReferralDto): Promise<ReferralSummaryDto> {
    return this.service.applyCode(user.id, dto.code);
  }
}
