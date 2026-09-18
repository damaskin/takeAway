import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { LoyaltyAccountDto } from './dto/loyalty.dto';
import { RedeemQuoteDto, RedeemQuoteRequestDto } from './dto/redeem-quote.dto';
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

  /**
   * How many points this customer can put toward an order, and what they
   * are worth. Checkout calls this rather than computing it locally: the
   * balance is server state, and the same clamping runs again when the
   * order is created.
   */
  @Post('redeem/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RedeemQuoteDto })
  async quoteRedemption(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemQuoteRequestDto,
  ): Promise<RedeemQuoteDto> {
    const [account, quote] = await Promise.all([
      this.loyalty.getForUser(user.id),
      this.loyalty.quoteRedemption(user.id, dto.points, dto.payableCents),
    ]);
    return {
      points: quote.points,
      discountCents: quote.discountCents,
      balance: account.pointsBalance,
      pointValueCents: this.loyalty.pointValueCents,
      minPoints: this.loyalty.minRedeemablePoints,
    };
  }
}
