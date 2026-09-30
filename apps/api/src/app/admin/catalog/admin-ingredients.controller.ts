import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminIngredientsService } from './admin-ingredients.service';
import { CreateIngredientDto, type IngredientAdminDto, UpdateIngredientDto } from './dto/admin-ingredient.dto';

@ApiTags('admin: ingredients')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR)
@Controller('admin/ingredients')
export class AdminIngredientsController {
  constructor(
    private readonly ingredients: AdminIngredientsService,
    private readonly scope: BrandScopeService,
  ) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: true })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId: string): Promise<IngredientAdminDto[]> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.ingredients.list(scope, brandId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateIngredientDto): Promise<IngredientAdminDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.ingredients.create(dto, scope);
  }

  /** `{ isAvailable: false }` is "ran out": its options disappear from the menu until it is back. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateIngredientDto,
  ): Promise<IngredientAdminDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.ingredients.update(id, dto, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.ingredients.delete(id, scope);
  }
}
