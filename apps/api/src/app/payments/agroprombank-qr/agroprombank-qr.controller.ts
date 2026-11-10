import { Body, Controller, Get, Header, HttpCode, HttpStatus, Logger, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AgroprombankQrPaymentDto } from '@takeaway/shared-types';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AgroprombankQrService } from './agroprombank-qr.service';
import { QR_PAYMENT_ROUTE } from './constants';
import { QrPaymentResponseDto, StartQrPaymentDto } from './dto/agroprombank-qr.dto';

const IS_DEV = process.env['NODE_ENV'] !== 'production';
const START_LIMIT = 20 * (IS_DEV ? 10 : 1);
/** The customer's screen polls every 3 s; a little headroom for a second tab. */
const STATUS_LIMIT = 40 * (IS_DEV ? 10 : 1);

/**
 * «Мобильный платёж»: an invoice to pay an order by QR in the bank's app, its
 * status for the customer's screen, closing it, and the callback the bank
 * registers for our terminal (docs/agroprombank-payments.md §12.3).
 */
@ApiTags('payments: agroprombank qr')
@Controller(QR_PAYMENT_ROUTE)
export class AgroprombankQrController {
  private readonly logger = new Logger(AgroprombankQrController.name);

  constructor(private readonly qr: AgroprombankQrService) {}

  /** Issues an invoice for the order — or answers the one already on offer, or the payment already made. */
  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: START_LIMIT, ttl: 60_000 } })
  @ApiOkResponse({ type: QrPaymentResponseDto })
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartQrPaymentDto): Promise<AgroprombankQrPaymentDto> {
    return this.qr.startPayment(user.id, dto.orderId);
  }

  /**
   * The bank's callback for our terminal: form fields `payments` (XML) and
   * `trx`. Public, unsigned, and only a reason to ask the bank; always
   * answered `200 OK`, whatever it carried.
   */
  @Public()
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiExcludeEndpoint()
  async callback(@Body() body: Record<string, unknown> | undefined): Promise<string> {
    try {
      await this.qr.handleCallback({ payments: field(body, 'payments'), trx: field(body, 'trx') });
    } catch (err) {
      this.logger.error(`QR callback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 'OK';
  }

  /** The payment as it stands; while it waits, the bank is asked (at most every 3 s). */
  @Get(':paymentId')
  @ApiBearerAuth()
  @Throttle({ default: { limit: STATUS_LIMIT, ttl: 60_000 } })
  @ApiOkResponse({ type: QrPaymentResponseDto })
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
  ): Promise<AgroprombankQrPaymentDto> {
    return this.qr.getPayment(user.id, paymentId);
  }

  /** The customer closed the QR screen: the invoice is closed unpaid (or found paid). */
  @Post(':paymentId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: START_LIMIT, ttl: 60_000 } })
  @ApiOkResponse({ type: QrPaymentResponseDto })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
  ): Promise<AgroprombankQrPaymentDto> {
    return this.qr.cancelPayment(user.id, paymentId);
  }
}

/** One form field, whatever shape the body parser gave it. */
function field(body: Record<string, unknown> | undefined, name: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const entry = Object.entries(body).find(([key]) => key.toLowerCase() === name)?.[1];
  const value = Array.isArray(entry) ? entry[0] : entry;
  return typeof value === 'string' ? value : null;
}
