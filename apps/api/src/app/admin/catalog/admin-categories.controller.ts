import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/admin-category.dto';

@ApiTags('admin: categories')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(
    private readonly admin: AdminCatalogService,
    private readonly scope: BrandScopeService,
  ) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: false })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.listCategories(scope, brandId);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.getCategory(id, scope);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.createCategory(dto, scope);
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderCategoriesDto): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.reorderCategories(dto, scope);
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.updateCategory(id, dto, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.deleteCategory(id, scope);
  }
}
