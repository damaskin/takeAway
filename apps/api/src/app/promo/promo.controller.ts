import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BrandScopeService } from '../auth/services/brand-scope.service';
import { RequiresPlanFeature } from '../plans/plan-feature.guard';
import { CreatePromoDto, PromoDto, UpdatePromoStatusDto, ValidPromoResultDto, ValidatePromoDto } from './dto/promo.dto';
import { PromoService } from './promo.service';

// Guessing codes through the open preview costs a request per guess; cap it
// per address. Dev gets 10x, like the auth routes.
const PREVIEW_PER_MINUTE = 20 * (process.env['NODE_ENV'] !== 'production' ? 10 : 1);

@ApiTags('promo')
@Controller()
export class PromoController {
  constructor(
    private readonly promo: PromoService,
    private readonly scope: BrandScopeService,
  ) {}

  // Customer — requires login (so we can enforce per-user limits).
  @ApiBearerAuth()
  @Post('promo/validate')
  @ApiOkResponse({ type: ValidPromoResultDto })
  validate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ValidatePromoDto): Promise<ValidPromoResultDto> {
    return this.promo.validate(user.id, dto.code, dto.brandId, dto.subtotalCents);
  }

  // Same validation, for signed-out guests that just want to preview a code.
  @Public()
  @Post('promo/preview')
  @Throttle({ default: { limit: PREVIEW_PER_MINUTE, ttl: 60_000 } })
  @ApiOkResponse({ type: ValidPromoResultDto })
  preview(@Body() dto: ValidatePromoDto): Promise<ValidPromoResultDto> {
    return this.promo.validate(null, dto.code, dto.brandId, dto.subtotalCents);
  }

  // Admin / brand-admin CRUD. Managing promo codes is a PRO feature; codes
  // already created keep working at checkout whatever the plan.
  @ApiBearerAuth()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @RequiresPlanFeature('promo')
  @Get('admin/promo')
  @ApiOkResponse({ type: PromoDto, isArray: true })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string): Promise<PromoDto[]> {
    if (brandId) await this.scope.assertBrand(user, brandId);
    const scope = brandId ? [brandId] : await this.scope.resolveBrandIds(user);
    return this.promo.list(scope);
  }

  @ApiBearerAuth()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @RequiresPlanFeature('promo')
  @Post('admin/promo')
  @ApiOkResponse({ type: PromoDto })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePromoDto): Promise<PromoDto> {
    await this.scope.assertBrand(user, dto.brandId);
    return this.promo.create(dto);
  }

  @ApiBearerAuth()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @RequiresPlanFeature('promo')
  @Patch('admin/promo/:id/status')
  @ApiOkResponse({ type: PromoDto })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePromoStatusDto,
  ): Promise<PromoDto> {
    await this.promo.assertOwned(user, id, this.scope);
    return this.promo.updateStatus(id, dto);
  }
}
