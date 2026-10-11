import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentResponseDto } from './dto/payment-intent.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intent')
  @ApiBearerAuth()
  @ApiOkResponse({ type: PaymentIntentResponseDto })
  createIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentIntentDto,
  ): Promise<PaymentIntentResponseDto> {
    return this.payments.createPaymentIntent(user.id, dto.orderId);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async webhook(@Req() req: { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string): Promise<void> {
    // Stripe signs the exact bytes it sent. main.ts keeps them (`rawBody`);
    // a re-serialised body can never match, so there is no fallback to one.
    if (!req.rawBody) throw new BadRequestException('Webhook body must be JSON');
    await this.payments.handleWebhook(req.rawBody, signature);
  }
}
