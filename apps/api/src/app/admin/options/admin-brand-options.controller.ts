import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type {
  BrandOptionCatalog,
  BrandOptionSetting,
  LegacyOptionsSummary,
  ProductOptionGroupsConfig,
} from '@takeaway/shared-types';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { KdsSessionAllowed } from '../../auth/decorators/kds-session.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import { UserStoreScopeService } from '../../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminBrandOptionsService } from './admin-brand-options.service';
import { AdminLegacyOptionsService } from './admin-legacy-options.service';
import { AdminProductOptionGroupsService } from './admin-product-option-groups.service';
import {
  BrandOptionCatalogDto,
  BrandOptionSettingDto,
  LegacyOptionsSummaryDto,
  OptionStopDto,
  ProductOptionGroupsConfigDto,
  SetOptionStopDto,
  UpdateBrandOptionDto,
} from './dto/admin-options.dto';

/**
 * A brand's side of the options catalog: one price per add-on for the whole
 * brand, and the options it does not have (switched off: hidden from its
 * customers). The roles that edit the add-ons library today, brand-scoped.
 * The older per-product options of a brand, and the action that clears
 * them, are the takeAway team's.
 */
@ApiTags('admin: brand options')
@ApiBearerAuth()
@Controller('admin/brands/:brandId')
export class AdminBrandOptionsController {
  constructor(
    private readonly options: AdminBrandOptionsService,
    private readonly legacy: AdminLegacyOptionsService,
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

  /** What clearing would delete. */
  @Get('legacy-options')
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ type: LegacyOptionsSummaryDto })
  legacySummary(@Param('brandId') brandId: string): Promise<LegacyOptionsSummary> {
    return this.legacy.summary(brandId);
  }

  /**
   * Deletes the brand's older options — variations, extras, category option
   * sets, the add-ons library and its store stops — in one transaction, and
   * answers what was deleted. Irreversible: on prod only with the owner's OK.
   */
  @Post('legacy-options/clear')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ type: LegacyOptionsSummaryDto })
  clearLegacy(@Param('brandId') brandId: string): Promise<LegacyOptionsSummary> {
    return this.legacy.clear(brandId);
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
 * variant's price, another default). The roles that edit products.
 *
 * Errors: 400 OPTION_GROUP_INVALID (unknown, reserved or repeated group; a
 * price on an add-on), 400 OPTION_NOT_ON_PRODUCT (an override outside the
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
