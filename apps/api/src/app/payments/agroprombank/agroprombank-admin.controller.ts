import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaymentProvider } from '@prisma/client';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankWebService, type WebPaymentView } from '../agroprombank-web/agroprombank-web.service';
import type { OperationState } from '../agroprombank-web/protocol';
import { AgroprombankService, type ChargeResult } from './agroprombank.service';
import { ChargeResponseDto, CompletePreauthDto, RefundOperationDto } from './dto/agroprombank.dto';

/**
 * Back-office operations on an Agroprombank payment — taken by either flow,
 * the bound card or the Web-платёж page: refunds, reversals, capturing a
 * hold and reading the bank's own record. Each route goes to the bank service
 * that took the payment.
 *
 * Every route is brand-scoped through the order's store, so a BRAND_ADMIN can
 * never touch another brand's money. STORE_MANAGER is included because
 * refunding a wrong order is a counter-level decision.
 */
@ApiTags('admin: payments')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
@Controller('admin/payments/agroprombank')
export class AgroprombankAdminController {
  constructor(
    private readonly agro: AgroprombankService,
    private readonly web: AgroprombankWebService,
    private readonly prisma: PrismaService,
    private readonly brandScope: BrandScopeService,
  ) {}

  /** The bank's own record of the operation — the source of truth for disputes. */
  @Get(':paymentId')
  async describe(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
  ): Promise<Record<string, unknown> | OperationState> {
    const provider = await this.assertScope(user, paymentId);
    return provider === 'AGROPROMBANK_WEB' ? this.web.describe(paymentId) : this.agro.describeOperation(paymentId);
  }

  /** Full or partial refund of a settled payment. Irreversible. */
  @Post(':paymentId/refund')
  @ApiOkResponse({ type: ChargeResponseDto })
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundOperationDto,
  ): Promise<ChargeResult | WebPaymentView> {
    const provider = await this.assertScope(user, paymentId);
    const audit = { actorId: user.id, source: 'admin' };
    return provider === 'AGROPROMBANK_WEB'
      ? this.web.refund(paymentId, dto.amountCents, audit)
      : this.agro.refund(paymentId, dto.amountCents, audit);
  }

  /** Cancels a payment — a hold, or a charge before it settles. Irreversible. */
  @Post(':paymentId/reverse')
  @ApiOkResponse({ type: ChargeResponseDto })
  async reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
  ): Promise<ChargeResult | WebPaymentView> {
    const provider = await this.assertScope(user, paymentId);
    return provider === 'AGROPROMBANK_WEB'
      ? this.web.cancel(paymentId, { actorId: user.id, reason: 'admin' })
      : this.agro.reverse(paymentId);
  }

  /** Captures a held payment, up to 110% of the amount held. */
  @Post(':paymentId/complete')
  @ApiOkResponse({ type: ChargeResponseDto })
  async complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: CompletePreauthDto,
  ): Promise<ChargeResult | WebPaymentView> {
    const provider = await this.assertScope(user, paymentId);
    return provider === 'AGROPROMBANK_WEB'
      ? this.web.complete(paymentId, dto.amountCents)
      : this.agro.completePreauthorization(paymentId, dto.amountCents);
  }

  private async assertScope(user: AuthenticatedUser, paymentId: string): Promise<PaymentProvider> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { provider: true, order: { select: { store: { select: { brandId: true } } } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.brandScope.assertBrand(user, payment.order.store.brandId);
    return payment.provider;
  }
}
