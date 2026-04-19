import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminStaffService } from './admin-staff.service';
import { AddStaffDto } from './dto/admin-staff.dto';

@ApiTags('admin: staff')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/stores/:storeId/staff')
export class AdminStaffController {
  constructor(private readonly staff: AdminStaffService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('storeId') storeId: string) {
    return this.staff.list(storeId, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(@CurrentUser() user: AuthenticatedUser, @Param('storeId') storeId: string, @Body() dto: AddStaffDto) {
    return this.staff.add(
      storeId,
      { email: dto.email, name: dto.name, role: dto.role, tempPassword: dto.tempPassword },
      user,
    );
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId') storeId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.staff.remove(storeId, userId, user);
  }
}
