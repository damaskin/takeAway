import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ImageUpload, UploadedImage, type UploadedImageFile } from '../../common/upload/uploaded-image.decorator';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminProductImagesService, type ProductImagesDto } from './admin-product-images.service';
import {
  CreateModifierDto,
  CreateProductDto,
  CreateVariationDto,
  ProductImageQueryDto,
  ReorderProductImagesDto,
  ReorderProductsDto,
  ToggleVisibilityDto,
  UpdateModifierDto,
  UpdateProductDto,
  UpdateVariationDto,
} from './dto/admin-product.dto';

@ApiTags('admin: products')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.MENU_EDITOR)
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private readonly admin: AdminCatalogService,
    private readonly images: AdminProductImagesService,
    private readonly scope: BrandScopeService,
  ) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.listProducts(scope, brandId, categoryId);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.getProduct(id, scope);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.createProduct(dto, scope);
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderProductsDto): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.reorderProducts(dto, scope);
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.updateProduct(id, dto, scope);
  }

  @Patch(':id/visibility')
  async toggleVisibility(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ToggleVisibilityDto,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.toggleProductVisibility(id, dto, scope);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.deleteProduct(id, scope);
  }

  /** One photo per request in a `file` field; appended to the end of the product's photos. */
  @Post(':id/images')
  @ImageUpload()
  @HttpCode(HttpStatus.CREATED)
  async uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedImage() file: UploadedImageFile,
  ): Promise<ProductImagesDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.images.add(id, file, scope);
  }

  @Delete(':id/images')
  async removeImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ProductImageQueryDto,
  ): Promise<ProductImagesDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.images.remove(id, query.url, scope);
  }

  @Put(':id/images/order')
  async reorderImages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReorderProductImagesDto,
  ): Promise<ProductImagesDto> {
    const scope = await this.scope.resolveBrandIds(user);
    return this.images.reorder(id, dto.urls, scope);
  }

  @Post(':id/variations')
  @HttpCode(HttpStatus.CREATED)
  async createVariation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateVariationDto,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.createVariation(id, dto, scope);
  }

  @Patch('variations/:variationId')
  async updateVariation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('variationId') id: string,
    @Body() dto: UpdateVariationDto,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.updateVariation(id, dto, scope);
  }

  @Delete('variations/:variationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVariation(@CurrentUser() user: AuthenticatedUser, @Param('variationId') id: string): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.deleteVariation(id, scope);
  }

  @Post(':id/modifiers')
  @HttpCode(HttpStatus.CREATED)
  async createModifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateModifierDto,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.createModifier(id, dto, scope);
  }

  @Patch('modifiers/:modifierId')
  async updateModifier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('modifierId') id: string,
    @Body() dto: UpdateModifierDto,
  ) {
    const scope = await this.scope.resolveBrandIds(user);
    return this.admin.updateModifier(id, dto, scope);
  }

  @Delete('modifiers/:modifierId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteModifier(@CurrentUser() user: AuthenticatedUser, @Param('modifierId') id: string): Promise<void> {
    const scope = await this.scope.resolveBrandIds(user);
    await this.admin.deleteModifier(id, scope);
  }
}
