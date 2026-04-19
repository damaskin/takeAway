import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminCatalogService } from './admin-catalog.service';
import { AddStopListEntryDto } from './dto/admin-stop-list.dto';
import { CreateStoreDto, ReplaceWorkingHoursDto, UpdateStoreDto } from './dto/admin-store.dto';

@ApiTags('admin: stores')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/stores')
export class AdminStoresController {
  constructor(
    private readonly admin: AdminCatalogService,
    private readonly scope: BrandScopeService,
  ) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: false })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.listStores(scope, brandId);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.getStore(id, scope);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStoreDto) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.createStore(dto, scope);
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStoreDto) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.updateStore(id, dto, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.deleteStore(id, scope);
  }

  @Put(':id/working-hours')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
  async replaceWorkingHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReplaceWorkingHoursDto,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.replaceWorkingHours(id, dto, scope);
  }

  @Get(':id/stop-list')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  async listStopList(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.listStopList(id, scope);
  }

  @Post(':id/stop-list')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  async addStopListEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddStopListEntryDto,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.addStopListEntry(id, dto, scope);
  }

  @Delete(':id/stop-list/:productId')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStopListEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.removeStopListEntry(id, productId, scope);
  }
}
