import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CARD_INSTITUTES } from './agroprombank.config';
import {
  AgroprombankService,
  type BoundCardView,
  type ChargeResult,
  type StartBindingResult,
} from './agroprombank.service';
import {
  BindCardDto,
  BoundCardDto,
  CardInstituteDto,
  ChargeCardDto,
  ChargeResponseDto,
  ConfirmBindingDto,
  StartBindingResponseDto,
} from './dto/agroprombank.dto';

// Binding is the only place a customer can guess at bank-side state (a phone
// number that isn't theirs, a one-time password they didn't receive), so both
// steps are rate-limited well below what a real customer needs. Dev gets a
// multiplier so iterating on the flow locally doesn't keep hitting the 429.
const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_MULTIPLIER = IS_DEV ? 10 : 1;
const limits = {
  bind: 5 * DEV_MULTIPLIER,
  confirm: 10 * DEV_MULTIPLIER,
  pay: 20 * DEV_MULTIPLIER,
};

/**
 * Customer-facing surface of the Agroprombank («Клевер») gateway: bind a card
 * once, then pay for orders with a single tap.
 */
@ApiTags('payments: agroprombank')
@Controller('payments/agroprombank')
export class AgroprombankController {
  constructor(private readonly agro: AgroprombankService) {}

  /** Issuers a customer can pick from when binding a card. */
  @Get('institutes')
  @Public()
  @ApiOkResponse({ type: [CardInstituteDto] })
  institutes(): CardInstituteDto[] {
    return CARD_INSTITUTES.map((i) => ({ code: i.code, name: i.name }));
  }

  @Get('cards')
  @ApiBearerAuth()
  @ApiOkResponse({ type: [BoundCardDto] })
  listCards(@CurrentUser() user: AuthenticatedUser): Promise<BoundCardView[]> {
    return this.agro.listCards(user.id);
  }

  /** Step 1 — the bank SMSes a one-time password to the customer. */
  @Post('cards/bind')
  @ApiBearerAuth()
  @Throttle({ default: { limit: limits.bind, ttl: 60_000 } })
  @ApiOkResponse({ type: StartBindingResponseDto })
  startBinding(@CurrentUser() user: AuthenticatedUser, @Body() dto: BindCardDto): Promise<StartBindingResult> {
    return this.agro.startBinding(user.id, dto);
  }

  /** Step 2 — exchange the one-time password for a reusable card token. */
  @Post('cards/bind/:bindingId/confirm')
  @ApiBearerAuth()
  @Throttle({ default: { limit: limits.confirm, ttl: 60_000 } })
  @ApiOkResponse({ type: BoundCardDto })
  confirmBinding(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bindingId') bindingId: string,
    @Body() dto: ConfirmBindingDto,
  ): Promise<BoundCardView> {
    return this.agro.confirmBinding(user.id, bindingId, dto.code);
  }

  /** Re-reads the card state from the bank (the customer may have revoked it). */
  @Post('cards/:cardId/refresh')
  @ApiBearerAuth()
  @ApiOkResponse({ type: BoundCardDto })
  refreshCard(@CurrentUser() user: AuthenticatedUser, @Param('cardId') cardId: string): Promise<BoundCardView> {
    return this.agro.refreshCard(user.id, cardId);
  }

  @Post('cards/:cardId/default')
  @ApiBearerAuth()
  @ApiOkResponse({ type: BoundCardDto })
  setDefaultCard(@CurrentUser() user: AuthenticatedUser, @Param('cardId') cardId: string): Promise<BoundCardView> {
    return this.agro.setDefaultCard(user.id, cardId);
  }

  @Delete('cards/:cardId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCard(@CurrentUser() user: AuthenticatedUser, @Param('cardId') cardId: string): Promise<void> {
    await this.agro.deleteCard(user.id, cardId);
  }

  /** Charges a bound card for an order and settles the order on success. */
  @Post('pay')
  @ApiBearerAuth()
  @Throttle({ default: { limit: limits.pay, ttl: 60_000 } })
  @ApiOkResponse({ type: ChargeResponseDto })
  pay(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChargeCardDto): Promise<ChargeResult> {
    return this.agro.charge(user.id, dto);
  }
}
