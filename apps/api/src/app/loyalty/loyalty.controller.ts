import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { LoyaltyAccountDto } from './dto/loyalty.dto';
import { LoyaltyService } from './loyalty.service';

@ApiTags('loyalty')
@ApiBearerAuth()
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('me')
  @ApiOkResponse({ type: LoyaltyAccountDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<LoyaltyAccountDto> {
    return this.loyalty.getForUser(user.id);
  }
}
