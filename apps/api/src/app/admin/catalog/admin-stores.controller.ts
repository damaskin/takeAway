import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminCatalogService } from './admin-catalog.service';
import { AddStopListEntryDto } from './dto/admin-stop-list.dto';
import { CreateStoreDto, ReplaceWorkingHoursDto, UpdateStoreDto } from './dto/admin-store.dto';

@ApiTags('admin: stores')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/stores')
export class AdminStoresController {
  constructor(private readonly admin: AdminCatalogService) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: false })
  list(@Query('brandId') brandId?: string) {
    return this.admin.listStores(brandId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.admin.getStore(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateStoreDto) {
    return this.admin.createStore(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStoreDto) {
    return this.admin.updateStore(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.admin.deleteStore(id);
  }

  @Put(':id/working-hours')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
  replaceWorkingHours(@Param('id') id: string, @Body() dto: ReplaceWorkingHoursDto) {
    return this.admin.replaceWorkingHours(id, dto);
  }

  @Get(':id/stop-list')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  listStopList(@Param('id') id: string) {
    return this.admin.listStopList(id);
  }

  @Post(':id/stop-list')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  addStopListEntry(@Param('id') id: string, @Body() dto: AddStopListEntryDto) {
    return this.admin.addStopListEntry(id, dto);
  }

  @Delete(':id/stop-list/:productId')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStopListEntry(@Param('id') id: string, @Param('productId') productId: string): Promise<void> {
    await this.admin.removeStopListEntry(id, productId);
  }
}
