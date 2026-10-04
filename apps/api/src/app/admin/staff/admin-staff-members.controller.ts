import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { StaffMember } from '@takeaway/shared-types';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminStaffMembersService } from './admin-staff-members.service';
import { ChangeStaffRoleDto, InviteStaffDto, SetStaffStoresDto } from './dto/admin-staff.dto';

/**
 * Staff as people: who works for the brand, in which of its stores.
 * `brandId` narrows everything to one brand — the admin always sends the
 * active one; without it the caller's whole reach is used.
 */
@ApiTags('admin: staff')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
@Controller('admin/staff')
export class AdminStaffMembersController {
  constructor(private readonly staff: AdminStaffMembersService) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: false })
  list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string): Promise<StaffMember[]> {
    return this.staff.list(user, brandId || undefined);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiQuery({ name: 'brandId', required: false })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteStaffDto,
    @Query('brandId') brandId?: string,
  ): Promise<StaffMember> {
    return this.staff.invite(
      { email: dto.email, name: dto.name, role: dto.role, tempPassword: dto.tempPassword, storeIds: dto.storeIds },
      user,
      brandId || undefined,
    );
  }

  @Get(':userId')
  @ApiQuery({ name: 'brandId', required: false })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Query('brandId') brandId?: string,
  ): Promise<StaffMember> {
    return this.staff.get(userId, user, brandId || undefined);
  }

  @Put(':userId/stores')
  @ApiQuery({ name: 'brandId', required: false })
  setStores(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: SetStaffStoresDto,
    @Query('brandId') brandId?: string,
  ): Promise<StaffMember> {
    return this.staff.setStores(userId, dto.storeIds, user, brandId || undefined);
  }

  @Patch(':userId/role')
  @ApiQuery({ name: 'brandId', required: false })
  changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: ChangeStaffRoleDto,
    @Query('brandId') brandId?: string,
  ): Promise<StaffMember> {
    return this.staff.changeRole(userId, dto.role, user, brandId || undefined);
  }
}
