import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/admin-category.dto';

@ApiTags('admin: categories')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly admin: AdminCatalogService) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: false })
  list(@Query('brandId') brandId?: string) {
    return this.admin.listCategories(brandId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.admin.getCategory(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCategoryDto) {
    return this.admin.createCategory(dto);
  }

  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(@Body() dto: ReorderCategoriesDto): Promise<void> {
    await this.admin.reorderCategories(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.admin.updateCategory(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.admin.deleteCategory(id);
  }
}
