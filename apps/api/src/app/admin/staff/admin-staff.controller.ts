import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsString, Matches } from 'class-validator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { KdsPinService } from '../../auth/services/kds-pin.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminStaffService } from './admin-staff.service';
import { AddStaffDto, ChangeStaffRoleDto } from './dto/admin-staff.dto';

/**
 * A new PIN is exactly 6 digits — PINs set earlier with 4 or 5 keep working
 * on the tablet, but none are handed out any more. The digits-only shape is
 * checked here; the "not 123456" rule in the handler, with its own code.
 */
class SetKdsPinDto {
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'pin must be exactly 6 digits' })
  pin!: string;
}

@ApiTags('admin: staff')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
@Controller('admin/stores/:storeId/staff')
export class AdminStaffController {
  constructor(
    private readonly staff: AdminStaffService,
    private readonly kdsPins: KdsPinService,
  ) {}

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

  @Patch(':userId/role')
  changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId') storeId: string,
    @Param('userId') userId: string,
    @Body() dto: ChangeStaffRoleDto,
  ) {
    return this.staff.changeRole(storeId, userId, dto.role, user);
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

  @Put(':userId/kds-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setKdsPin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId') storeId: string,
    @Param('userId') userId: string,
    @Body() dto: SetKdsPinDto,
  ): Promise<void> {
    // 400 KDS_PIN_FORMAT / KDS_PIN_TOO_SIMPLE before anything is looked up.
    this.kdsPins.assertNewPinAllowed(dto.pin);
    await this.staff.setKdsPin(storeId, userId, dto.pin, user);
  }

  @Delete(':userId/kds-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearKdsPin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId') storeId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.staff.clearKdsPin(storeId, userId, user);
  }
}
