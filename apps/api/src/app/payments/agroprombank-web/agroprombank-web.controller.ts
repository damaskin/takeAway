import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AgroprombankWebService, type StartWebPaymentResult } from './agroprombank-web.service';
import { WEB_PAYMENT_ROUTE } from './constants';
import { StartWebPaymentDto, StartWebPaymentResponseDto } from './dto/agroprombank-web.dto';
import { normalizeParams } from './protocol';

const IS_DEV = process.env['NODE_ENV'] !== 'production';
const START_LIMIT = 20 * (IS_DEV ? 10 : 1);

/** Whatever the bank sent, from the query string and the body alike. */
type BankParams = Record<string, unknown>;

/**
 * Web-платёж: start a payment on the bank's page, and the three addresses
 * registered at the bank — ResultURL (the notification), SuccessURL and
 * FailURL (the customer coming back). Those three are public and accept GET
 * and POST, because the method is chosen once, at registration, on the
 * bank's side.
 */
@ApiTags('payments: agroprombank web')
@Controller(WEB_PAYMENT_ROUTE)
export class AgroprombankWebController {
  constructor(private readonly web: AgroprombankWebService) {}

  /** Issues an invoice and returns the bank page to send the customer to. */
  @Post('start')
  @ApiBearerAuth()
  @Throttle({ default: { limit: START_LIMIT, ttl: 60_000 } })
  @ApiOkResponse({ type: StartWebPaymentResponseDto })
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartWebPaymentDto): Promise<StartWebPaymentResult> {
    return this.web.startPayment(user.id, dto);
  }

  /** ResultURL — the bank's notification. */
  @Public()
  @Get('result')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiExcludeEndpoint()
  resultGet(@Query() query: BankParams): Promise<string> {
    return this.result(query);
  }

  @Public()
  @Post('result')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiExcludeEndpoint()
  resultPost(@Query() query: BankParams, @Body() body: BankParams | undefined): Promise<string> {
    return this.result({ ...query, ...(body ?? {}) });
  }

  /** SuccessURL — the customer paid and is on their way back. */
  @Public()
  @Get('success')
  @Redirect()
  @ApiExcludeEndpoint()
  successGet(@Query() query: BankParams): Promise<{ url: string; statusCode: number }> {
    return this.back('success', query);
  }

  @Public()
  @Post('success')
  @Redirect()
  @ApiExcludeEndpoint()
  successPost(
    @Query() query: BankParams,
    @Body() body: BankParams | undefined,
  ): Promise<{ url: string; statusCode: number }> {
    return this.back('success', { ...query, ...(body ?? {}) });
  }

  /** FailURL — the payment did not go through. */
  @Public()
  @Get('fail')
  @Redirect()
  @ApiExcludeEndpoint()
  failGet(@Query() query: BankParams): Promise<{ url: string; statusCode: number }> {
    return this.back('fail', query);
  }

  @Public()
  @Post('fail')
  @Redirect()
  @ApiExcludeEndpoint()
  failPost(
    @Query() query: BankParams,
    @Body() body: BankParams | undefined,
  ): Promise<{ url: string; statusCode: number }> {
    return this.back('fail', { ...query, ...(body ?? {}) });
  }

  /**
   * The bank documents no response body for ResultURL; a 200 with `OK` is
   * what such gateways expect. A notification that fails its signature gets
   * a 400 — the bank then mails our support address, which is the alert we
   * want for a forged or garbled callback.
   */
  private async result(raw: BankParams): Promise<string> {
    const accepted = await this.web.handleNotification(normalizeParams(raw));
    if (!accepted) throw new BadRequestException('Notification rejected');
    return 'OK';
  }

  private async back(outcome: 'success' | 'fail', raw: BankParams): Promise<{ url: string; statusCode: number }> {
    const url = await this.web.handleReturn(outcome, normalizeParams(raw));
    // Browsers follow a 302 after the bank's POST with a GET of the order page.
    return { url, statusCode: HttpStatus.FOUND };
  }
}
