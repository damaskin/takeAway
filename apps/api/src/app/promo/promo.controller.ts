import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreatePromoDto, PromoDto, UpdatePromoStatusDto, ValidPromoResultDto, ValidatePromoDto } from './dto/promo.dto';
import { PromoService } from './promo.service';

@ApiTags('promo')
@Controller()
export class PromoController {
  constructor(private readonly promo: PromoService) {}

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
  @ApiOkResponse({ type: ValidPromoResultDto })
  preview(@Body() dto: ValidatePromoDto): Promise<ValidPromoResultDto> {
    return this.promo.validate(null, dto.code, dto.brandId, dto.subtotalCents);
  }

  // Admin / brand-admin CRUD.
  @ApiBearerAuth()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @Get('admin/promo')
  @ApiOkResponse({ type: PromoDto, isArray: true })
  list(@Query('brandId') brandId?: string): Promise<PromoDto[]> {
    return this.promo.list(brandId);
  }

  @ApiBearerAuth()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @Post('admin/promo')
  @ApiOkResponse({ type: PromoDto })
  create(@Body() dto: CreatePromoDto): Promise<PromoDto> {
    return this.promo.create(dto);
  }

  @ApiBearerAuth()
  @Roles('BRAND_ADMIN', 'SUPER_ADMIN')
  @Patch('admin/promo/:id/status')
  @ApiOkResponse({ type: PromoDto })
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePromoStatusDto): Promise<PromoDto> {
    return this.promo.updateStatus(id, dto);
  }
}
