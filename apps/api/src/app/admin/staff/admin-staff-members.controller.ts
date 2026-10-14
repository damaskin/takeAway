import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { StaffInviteResult, StaffMember, StaffPasswordReset } from '@takeaway/shared-types';

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
  ): Promise<StaffInviteResult> {
    return this.staff.invite(
      {
        email: dto.email,
        login: dto.login,
        name: dto.name,
        role: dto.role,
        tempPassword: dto.tempPassword,
        storeIds: dto.storeIds,
      },
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

  /**
   * «Сбросить пароль»: a generated temporary password, answered once, to be
   * changed at the next sign-in; the person's sessions end, and they are
   * emailed a link to set their own when the server can send mail and they
   * have an email (`NO_EMAIL` for someone signing in with a login). Owners
   * and platform admins only — not store managers.
   */
  @Post(':userId/reset-password')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
  @ApiQuery({ name: 'brandId', required: false })
  @ApiOkResponse({
    schema: {
      properties: {
        tempPassword: { type: 'string' },
        resetEmail: { type: 'string', enum: ['SENT', 'NOT_CONFIGURED', 'FAILED', 'NO_EMAIL'] },
      },
    },
  })
  @ApiForbiddenResponse({
    description: '`STAFF_NOT_EDITABLE` — the caller themself, or someone who also works for another brand.',
  })
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Query('brandId') brandId?: string,
  ): Promise<StaffPasswordReset> {
    return this.staff.resetPassword(userId, user, brandId || undefined);
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
