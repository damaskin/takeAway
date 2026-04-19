import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminRidersService } from './admin-riders.service';
import { AddRiderDto } from './dto/rider-roster.dto';

@ApiTags('admin: riders')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/stores/:storeId/riders')
export class AdminRidersController {
  constructor(private readonly riders: AdminRidersService) {}

  @Get()
  list(@Param('storeId') storeId: string) {
    return this.riders.list(storeId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(@Param('storeId') storeId: string, @Body() dto: AddRiderDto) {
    return this.riders.add(storeId, dto.phone, dto.name);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('storeId') storeId: string, @Param('userId') userId: string): Promise<void> {
    await this.riders.remove(storeId, userId);
  }
}
