import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
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
  async webhook(
    @Req() req: { body?: unknown; rawBody?: Buffer },
    @Headers('stripe-signature') signature?: string,
  ): Promise<void> {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    await this.payments.handleWebhook(raw, signature);
  }
}
