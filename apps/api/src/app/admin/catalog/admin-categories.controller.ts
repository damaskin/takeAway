import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminCategoryOptionsService } from './admin-category-options.service';
import {
  AddCategoryOptionsDto,
  type ApplyCategoryOptionsResultDto,
  type CategoryOptionDto,
  UpdateCategoryOptionDto,
} from './dto/admin-category-option.dto';
import {
  CreateCategoryDto,
  DeleteCategoryQueryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './dto/admin-category.dto';

@ApiTags('admin: categories')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(
    private readonly admin: AdminCatalogService,
    private readonly options: AdminCategoryOptionsService,
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

  /** 409 `CATEGORY_NOT_EMPTY` while products remain, unless `moveProductsTo` names where they go. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: DeleteCategoryQueryDto,
  ): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.deleteCategory(id, scope, query.moveProductsTo);
  }

  // ── Option set («Опции категории») ────────────────────────────────────────
  @Get(':id/options')
  async listOptions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<CategoryOptionDto[]> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.options.list(id, scope);
  }

  /** Appends options (e.g. a ready-made preset) to the set; ones it has are skipped. Answers the whole set. */
  @Post(':id/options')
  async addOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddCategoryOptionsDto,
  ): Promise<CategoryOptionDto[]> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.options.add(id, dto, scope);
  }

  /** Copies what each product of the category lacks from the set; never removes or reprices. */
  @Post(':id/options/apply')
  @HttpCode(HttpStatus.OK)
  async applyOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplyCategoryOptionsResultDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.options.apply(id, scope);
  }

  @Patch(':id/options/:optionId')
  async updateOption(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateCategoryOptionDto,
  ): Promise<CategoryOptionDto[]> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.options.update(id, optionId, dto, scope);
  }

  /** Out of the set only: products that have the option keep it. */
  @Delete(':id/options/:optionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOption(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('optionId') optionId: string,
  ): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.options.remove(id, optionId, scope);
  }

  /** Every product of the category gets the category's default preparation time. */
  @Post(':id/prep-time/apply')
  @HttpCode(HttpStatus.OK)
  async applyPrepTime(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<{ products: number }> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.options.applyPrepTime(id, scope);
  }
}
