import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import { UserStoreScopeService } from '../../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ImageUpload, UploadedImage, type UploadedImageFile } from '../../common/upload/uploaded-image.decorator';
import { StorageService } from '../../storage/storage.service';
import { AdminCatalogService } from './admin-catalog.service';
import { StoreAvailabilityService } from './store-availability.service';
import { AddStopListEntryDto } from './dto/admin-stop-list.dto';
import { SetIngredientStopDto, StoreAvailabilityDto } from './dto/admin-store-availability.dto';
import {
  CreateStoreDto,
  RemoveStoreImageQueryDto,
  ReplaceWorkingHoursDto,
  StoreImageQueryDto,
  UpdateStoreDto,
} from './dto/admin-store.dto';

@ApiTags('admin: stores')
@ApiBearerAuth()
@Controller('admin/stores')
export class AdminStoresController {
  constructor(
    private readonly admin: AdminCatalogService,
    private readonly scope: BrandScopeService,
    private readonly stores: UserStoreScopeService,
    private readonly storage: StorageService,
    private readonly availability: StoreAvailabilityService,
  ) {}

  // Brand scope keeps everyone inside their brand; the store scope keeps a
  // store manager or staff member inside the stores they actually work at.
  // Without it, the manager of one café could edit every café of the brand.

  // STORE_MANAGER needs read access so the admin can show their assigned stores
  // for hours / stop-list management; STAFF gets read for the stop-list flow.
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @ApiQuery({ name: 'brandId', required: false })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string) {
    const scope = await this.scope.resolveBrandIds(user);
    const stores = await this.admin.listStores(scope, brandId);
    const own = await this.stores.getScope(user.id, user.role);
    return own === '*' ? stores : stores.filter((s) => own.includes(s.id));
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.getStoreDetail(id, scope);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStoreDto) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.createStore(dto, scope);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStoreDto) {
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.updateStore(id, dto, scope);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.stores.assertAllowed(user.id, user.role, id);
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
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.replaceWorkingHours(id, dto, scope);
  }

  /**
   * One photo per request, as the `file` field of a multipart body:
   * `kind=hero` replaces the cover, `kind=gallery` adds to the gallery.
   */
  @Post(':id/images')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
  @ImageUpload()
  async uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: StoreImageQueryDto,
    @UploadedImage() file: UploadedImageFile,
  ): Promise<{ heroImageUrl: string | null; galleryUrls: string[] }> {
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    const store = await this.admin.getStore(id, scope);
    // Checked before the upload too, so a full gallery doesn't leave an
    // orphaned object in the bucket.
    if (query.kind === 'gallery') this.admin.assertGalleryRoom(store.galleryUrls);
    const { url } = await this.storage.uploadImage(`stores/${store.slug}`, file.filename, file.mimetype, file.buffer);
    return this.admin.attachStoreImage(id, query.kind, url, scope);
  }

  @Delete(':id/images')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
  async removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: RemoveStoreImageQueryDto,
  ): Promise<{ heroImageUrl: string | null; galleryUrls: string[] }> {
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.removeStoreImage(id, query.kind, query.url, scope);
  }

  @Get(':id/stop-list')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  async listStopList(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.stores.assertAllowed(user.id, user.role, id);
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
    await this.stores.assertAllowed(user.id, user.role, id);
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
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.removeStopListEntry(id, productId, scope);
  }

  // The stop-list screen. Kitchen STAFF of the store work it: they switch
  // products and add-ins off and on here, and nothing else — creating,
  // editing and deleting stays on the menu endpoints, which STAFF cannot call.

  @Get(':id/availability')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @ApiOkResponse({ type: StoreAvailabilityDto })
  async getAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<StoreAvailabilityDto> {
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    return this.availability.get(id, scope);
  }

  @Put(':id/ingredient-stops/:ingredientId')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  async stopIngredient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('ingredientId') ingredientId: string,
    @Body() dto: SetIngredientStopDto,
  ) {
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    return this.availability.stopIngredient(id, ingredientId, dto, scope);
  }

  @Delete(':id/ingredient-stops/:ingredientId')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resumeIngredient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('ingredientId') ingredientId: string,
  ): Promise<void> {
    await this.stores.assertAllowed(user.id, user.role, id);
    const scope = await this.scope.resolveBrandIds(user);
    await this.availability.resumeIngredient(id, ingredientId, scope);
  }
}
