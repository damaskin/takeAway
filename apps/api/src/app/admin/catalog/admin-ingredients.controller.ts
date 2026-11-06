import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminIngredientsService } from './admin-ingredients.service';
import { CreateIngredientDto, type IngredientAdminDto, UpdateIngredientDto } from './dto/admin-ingredient.dto';

/**
 * The add-ons library. Every role that edits the menu reads it and picks
 * from it; a brand's roles switch an add-in on or off and set its price,
 * and only SUPER_ADMIN adds, renames, regroups or deletes one (the service
 * answers anything else with 403 INGREDIENT_LIBRARY_LOCKED).
 */
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

  /** Add-on groups the brand uses («Сиропы», «Соусы»…), for suggestions in the editors. */
  @Get('groups')
  @ApiQuery({ name: 'brandId', required: true })
  async groups(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId: string): Promise<string[]> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.ingredients.groups(scope, brandId);
  }

  /** SUPER_ADMIN only (403 INGREDIENT_LIBRARY_LOCKED for a brand). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateIngredientDto): Promise<IngredientAdminDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.ingredients.create(dto, scope);
  }

  /**
   * `{ isAvailable: false }` is "ran out": its options disappear from the menu until it is back.
   * A new name or price reaches every option that still carries the old one. A brand may
   * change `isAvailable` and `priceCents` only (403 INGREDIENT_LIBRARY_LOCKED otherwise).
   */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateIngredientDto,
  ): Promise<IngredientAdminDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.ingredients.update(id, dto, scope);
  }

  /** Takes the add-on off every product that offers it, then out of the library. SUPER_ADMIN only. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.ingredients.delete(id, scope);
  }
}
