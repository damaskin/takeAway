import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminCatalogService } from './admin-catalog.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/admin-brand.dto';

@ApiTags('admin: brands')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(private readonly admin: AdminCatalogService) {}

  @Get()
  list() {
    return this.admin.listBrands();
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
}
