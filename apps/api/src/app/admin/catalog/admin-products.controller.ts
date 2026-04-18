import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminCatalogService } from './admin-catalog.service';
import {
  CreateModifierDto,
  CreateProductDto,
  CreateVariationDto,
  ToggleVisibilityDto,
  UpdateModifierDto,
  UpdateProductDto,
  UpdateVariationDto,
} from './dto/admin-product.dto';

@ApiTags('admin: products')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly admin: AdminCatalogService) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  list(@Query('brandId') brandId?: string, @Query('categoryId') categoryId?: string) {
    return this.admin.listProducts(brandId, categoryId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.admin.getProduct(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProductDto) {
    return this.admin.createProduct(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.admin.updateProduct(id, dto);
  }

  @Patch(':id/visibility')
  toggleVisibility(@Param('id') id: string, @Body() dto: ToggleVisibilityDto) {
    return this.admin.toggleProductVisibility(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.admin.deleteProduct(id);
  }

  @Post(':id/variations')
  @HttpCode(HttpStatus.CREATED)
  createVariation(@Param('id') id: string, @Body() dto: CreateVariationDto) {
    return this.admin.createVariation(id, dto);
  }

  @Patch('variations/:variationId')
  updateVariation(@Param('variationId') id: string, @Body() dto: UpdateVariationDto) {
    return this.admin.updateVariation(id, dto);
  }

  @Delete('variations/:variationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVariation(@Param('variationId') id: string): Promise<void> {
    await this.admin.deleteVariation(id);
  }

  @Post(':id/modifiers')
  @HttpCode(HttpStatus.CREATED)
  createModifier(@Param('id') id: string, @Body() dto: CreateModifierDto) {
    return this.admin.createModifier(id, dto);
  }

  @Patch('modifiers/:modifierId')
  updateModifier(@Param('modifierId') id: string, @Body() dto: UpdateModifierDto) {
    return this.admin.updateModifier(id, dto);
  }

  @Delete('modifiers/:modifierId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteModifier(@Param('modifierId') id: string): Promise<void> {
    await this.admin.deleteModifier(id);
  }
}
