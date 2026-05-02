import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { BrandScopeService } from '../auth/services/brand-scope.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { GiftCardDto, GiftCardValidationDto, IssueGiftCardDto, ValidateGiftCardDto } from './dto/issue-gift-card.dto';
import { GiftCardsService } from './gift-cards.service';

@ApiTags('gift-cards')
@ApiBearerAuth()
@Controller()
export class GiftCardsController {
  constructor(
    private readonly cards: GiftCardsService,
    private readonly prisma: PrismaService,
    private readonly brandScope: BrandScopeService,
  ) {}

  /**
   * Customer-facing — validate a code against the brand of the cart's
   * store. Returns how much we'd be able to apply to an order with the
   * current subtotal. Used by the checkout page to show a "applied" hint
   * before the user clicks Pay.
   */
  @Post('gift-cards/validate')
  @ApiOkResponse({ type: GiftCardValidationDto })
  async validate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValidateGiftCardDto,
  ): Promise<GiftCardValidationDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: dto.cartId },
      include: { items: true, store: { select: { brandId: true, currency: true } } },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.userId !== user.id) throw new NotFoundException('Cart not found');
    const subtotalCents = cart.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    if (subtotalCents <= 0) throw new BadRequestException('Cart is empty');

    const v = await this.cards.validateForOrder({
      code: dto.code,
      brandId: cart.store.brandId,
      subtotalCents,
      currency: cart.store.currency,
    });
    return {
      applicableCents: v.amountCents,
      remainingCents: v.remainingCents,
      currency: v.currency,
    };
  }

  // ── Admin (BRAND_ADMIN scoped) ────────────────────────────────────────────

  @Get('admin/gift-cards')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiOkResponse({ type: GiftCardDto, isArray: true })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string): Promise<GiftCardDto[]> {
    const resolved = await this.resolveBrandId(user, brandId);
    const rows = await this.cards.list(resolved);
    return rows.map(toGiftCardDto);
  }

  @Post('admin/gift-cards')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  @ApiOkResponse({ type: GiftCardDto })
  async issue(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IssueGiftCardDto,
    @Query('brandId') brandId?: string,
  ): Promise<GiftCardDto> {
    const resolved = await this.resolveBrandId(user, brandId);
    const card = await this.cards.issue({
      brandId: resolved,
      amountCents: dto.amountCents,
      currency: dto.currency,
      recipientEmail: dto.recipientEmail ?? null,
      recipientName: dto.recipientName ?? null,
      message: dto.message ?? null,
      expiresAt: dto.expiresAt ?? null,
    });
    return toGiftCardDto(card);
  }

  @Delete('admin/gift-cards/:id')
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @ApiOkResponse({ type: GiftCardDto })
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<GiftCardDto> {
    const card = await this.prisma.giftCard.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('Gift card not found');
    await this.assertCanManageBrand(user, card.brandId);
    const updated = await this.cards.cancel(card.brandId, id);
    return toGiftCardDto(updated);
  }

  /** Resolves and authorizes the brand scope for an admin endpoint. */
  private async resolveBrandId(user: AuthenticatedUser, brandId?: string): Promise<string> {
    const scope = await this.brandScope.resolveBrandIds(user);
    if (scope === null) {
      if (!brandId) throw new BadRequestException('SUPER_ADMIN must pass ?brandId=');
      return brandId;
    }
    if (brandId) {
      if (!scope.includes(brandId)) throw new NotFoundException('Brand not found');
      return brandId;
    }
    const first = scope[0];
    if (!first) throw new NotFoundException('No brand owned by this user');
    return first;
  }

  private async assertCanManageBrand(user: AuthenticatedUser, brandId: string): Promise<void> {
    await this.brandScope.assertBrand(user, brandId);
  }
}

function toGiftCardDto(card: {
  id: string;
  code: string;
  brandId: string;
  initialAmountCents: number;
  balanceCents: number;
  currency: string;
  status: string;
  recipientEmail: string | null;
  recipientName: string | null;
  message: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}): GiftCardDto {
  return {
    id: card.id,
    code: card.code,
    brandId: card.brandId,
    initialAmountCents: card.initialAmountCents,
    balanceCents: card.balanceCents,
    currency: card.currency as GiftCardDto['currency'],
    status: card.status as GiftCardDto['status'],
    recipientEmail: card.recipientEmail,
    recipientName: card.recipientName,
    message: card.message,
    expiresAt: card.expiresAt ? card.expiresAt.toISOString() : null,
    createdAt: card.createdAt.toISOString(),
  };
}
