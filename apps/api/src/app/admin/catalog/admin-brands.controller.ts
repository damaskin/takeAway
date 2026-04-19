import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BrandModerationStatus, Role } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminCatalogService } from './admin-catalog.service';
import { SetBrandModerationDto } from './dto/admin-brand-moderation.dto';
import { CreateBrandDto, UpdateBrandDto } from './dto/admin-brand.dto';

@ApiTags('admin: brands')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(private readonly admin: AdminCatalogService) {}

  @Get()
  list(@Query('status') status?: BrandModerationStatus) {
    return this.admin.listBrands(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.admin.getBrand(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateBrandDto) {
    return this.admin.createBrand(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.admin.updateBrand(id, dto);
  }

  @Patch(':id/moderation')
  setModeration(@Param('id') id: string, @Body() dto: SetBrandModerationDto) {
    return this.admin.setBrandModeration(id, dto);
  }
}
