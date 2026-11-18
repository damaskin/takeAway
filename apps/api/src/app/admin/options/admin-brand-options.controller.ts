import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { BrandOptionCatalog, BrandOptionSetting, ProductOptionGroupsConfig } from '@takeaway/shared-types';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { KdsSessionAllowed } from '../../auth/decorators/kds-session.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import { UserStoreScopeService } from '../../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminBrandOptionsService } from './admin-brand-options.service';
import { AdminProductOptionGroupsService } from './admin-product-option-groups.service';
import {
  ApplyGroupPriceDto,
  BrandOptionCatalogDto,
  BrandOptionSettingDto,
  OptionStopDto,
  ProductOptionGroupsConfigDto,
  SetOptionStopDto,
  UpdateBrandOptionDto,
} from './dto/admin-options.dto';

/**
 * A brand's side of the options catalog: one price per add-on for the whole
 * brand, and the options it does not have (switched off: hidden from its
 * customers). The roles that edit the add-ons library today, brand-scoped.
 */
@ApiTags('admin: brand options')
@ApiBearerAuth()
@Controller('admin/brands/:brandId')
export class AdminBrandOptionsController {
  constructor(
    private readonly options: AdminBrandOptionsService,
    private readonly scope: BrandScopeService,
  ) {}

  @Get('options')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR)
  @ApiOkResponse({ type: BrandOptionCatalogDto })
  async catalog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('brandId') brandId: string,
  ): Promise<BrandOptionCatalog> {
    return this.options.catalog(await this.scope.resolveBrandIds(user), brandId);
  }

  @Patch('options/:optionId')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR)
  @ApiOkResponse({ type: BrandOptionSettingDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('brandId') brandId: string,
    @Param('optionId') optionId: string,
    @Body() dto: UpdateBrandOptionDto,
  ): Promise<BrandOptionSetting> {
    return this.options.update(await this.scope.resolveBrandIds(user), brandId, optionId, dto);
  }

  /**
   * «Применить ко всем»: one price for every option of an add-on group, for
   * the whole brand. 400 OPTION_GROUP_INVALID for a variant group (priced
   * per product).
   */
  @Put('option-groups/:groupId/price')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR)
  @ApiOkResponse({ type: BrandOptionSettingDto, isArray: true })
  async applyGroupPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('brandId') brandId: string,
    @Param('groupId') groupId: string,
    @Body() dto: ApplyGroupPriceDto,
  ): Promise<BrandOptionSetting[]> {
    return this.options.applyGroupPrice(await this.scope.resolveBrandIds(user), brandId, groupId, dto);
  }
}

/**
 * A store has run out of a catalog option: shown greyed out there and
 * refused by its cart; the brand's other stores keep selling it. The roles
 * that stop add-ins in a store today — kitchen staff and PIN sessions of the
 * store included.
 */
@ApiTags('admin: brand options')
@ApiBearerAuth()
@Controller('admin/stores/:storeId/option-stops')
export class AdminStoreOptionStopsController {
  constructor(
    private readonly options: AdminBrandOptionsService,
    private readonly scope: BrandScopeService,
    private readonly stores: UserStoreScopeService,
  ) {}

  @Put(':optionId')
  @KdsSessionAllowed({ from: 'param', key: 'storeId' })
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @ApiOkResponse({ type: OptionStopDto })
  async stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId') storeId: string,
    @Param('optionId') optionId: string,
    @Body() dto: SetOptionStopDto,
  ): Promise<OptionStopDto> {
    await this.stores.assertAllowed(user.id, user.role, storeId);
    return this.options.stop(await this.scope.resolveBrandIds(user), storeId, optionId, dto);
  }

  @Delete(':optionId')
  @KdsSessionAllowed({ from: 'param', key: 'storeId' })
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId') storeId: string,
    @Param('optionId') optionId: string,
  ): Promise<void> {
    await this.stores.assertAllowed(user.id, user.role, storeId);
    await this.options.resume(await this.scope.resolveBrandIds(user), storeId, optionId);
  }
}

/**
 * The catalog groups of a product and its own values for single options (a
 * variant's surcharge, an add-on's own price, another default, an option
 * switched off on it). The roles that edit products.
 *
 * Errors: 400 OPTION_GROUP_INVALID (unknown, reserved or repeated group; a
 * negative add-on price), 400 OPTION_NOT_ON_PRODUCT (an override outside the
 * groups sent).
 */
@ApiTags('admin: products')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR)
@Controller('admin/products/:id/option-groups')
export class AdminProductOptionGroupsController {
  constructor(
    private readonly products: AdminProductOptionGroupsService,
    private readonly scope: BrandScopeService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ProductOptionGroupsConfigDto })
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ProductOptionGroupsConfig> {
    return this.products.get(await this.scope.resolveBrandIds(user), id);
  }

  /** Replaces the product's groups and overrides as one piece. */
  @Put()
  @ApiOkResponse({ type: ProductOptionGroupsConfigDto })
  async replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ProductOptionGroupsConfigDto,
  ): Promise<ProductOptionGroupsConfig> {
    return this.products.replace(await this.scope.resolveBrandIds(user), id, dto);
  }
}
