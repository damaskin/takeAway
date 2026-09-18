import { BadRequestException, Body, Controller, ForbiddenException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { RefundOrderDto, RefundOrderResponseDto } from './dto/refund-order.dto';
import { PaymentsService } from './payments.service';

@ApiTags('admin: payments')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
@Controller('admin/orders')
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly scope: UserStoreScopeService,
  ) {}

  /**
   * Issue a refund (full or partial) for a paid order.
   *
   * Authorisation:
   *   - SUPER_ADMIN  → any order
   *   - BRAND_ADMIN  → orders whose store belongs to a brand they own
   *   - STORE_MANAGER → orders whose storeId is in their UserStore scope
   */
  @Post(':id/refund')
  @ApiOkResponse({ type: RefundOrderResponseDto })
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') orderId: string,
    @Body() dto: RefundOrderDto,
  ): Promise<RefundOrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, storeId: true, store: { select: { brandId: true } } },
    });
    if (!order) throw new BadRequestException('Order not found');

    await this.assertCanRefund(user, order.storeId, order.store.brandId);

    return this.payments.refundOrder(orderId, {
      amountCents: dto.amountCents,
      reason: dto.reason,
      note: dto.note,
      actorId: user.id,
    });
  }

  private async assertCanRefund(user: AuthenticatedUser, storeId: string, brandId: string): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;

    if (user.role === Role.BRAND_ADMIN) {
      const owns = await this.prisma.brand.findFirst({
        where: { id: brandId, ownerId: user.id },
        select: { id: true },
      });
      if (!owns) throw new ForbiddenException('Refund denied: brand not owned by this admin');
      return;
    }

    if (user.role === Role.STORE_MANAGER) {
      const scope = await this.scope.getScope(user.id, user.role);
      if (scope === '*') return;
      if (!scope.includes(storeId)) throw new ForbiddenException('Refund denied: store outside manager scope');
      return;
    }

    throw new ForbiddenException('Refund denied');
  }
}
