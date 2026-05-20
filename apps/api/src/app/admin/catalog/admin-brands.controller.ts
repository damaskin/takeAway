import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BrandModerationStatus, Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminCatalogService } from './admin-catalog.service';
import { SetBrandModerationDto } from './dto/admin-brand-moderation.dto';
import { CreateBrandDto, UpdateBrandDto } from './dto/admin-brand.dto';

@ApiTags('admin: brands')
@ApiBearerAuth()
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(
    private readonly admin: AdminCatalogService,
    private readonly scope: BrandScopeService,
  ) {}

  /**
   * Brands the current user can act on. Powers the active-brand selector
   * in the admin shell, so every signed-in admin role needs access — the
   * resolver narrows the result to their actual scope.
   */
  @Get('mine')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR, Role.STAFF, Role.RIDER)
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.listBrandsForScope(scope);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  list(@Query('status') status?: BrandModerationStatus) {
    return this.admin.listBrands(status);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN)
  get(@Param('id') id: string) {
    return this.admin.getBrand(id);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateBrandDto) {
    return this.admin.createBrand(dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.admin.updateBrand(id, dto);
  }

  @Patch(':id/moderation')
  @Roles(Role.SUPER_ADMIN)
  setModeration(@Param('id') id: string, @Body() dto: SetBrandModerationDto) {
    return this.admin.setBrandModeration(id, dto);
  }
}
