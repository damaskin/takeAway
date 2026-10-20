import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { StaffInviteResult, StaffMember, StaffPasswordReset } from '@takeaway/shared-types';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { KdsPinService } from '../../auth/services/kds-pin.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminStaffMembersService } from './admin-staff-members.service';
import {
  AddStaffSignInDto,
  ChangeStaffRoleDto,
  InviteStaffDto,
  SetStaffPinDto,
  SetStaffStoresDto,
} from './dto/admin-staff.dto';

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
  constructor(
    private readonly staff: AdminStaffMembersService,
    private readonly kdsPins: KdsPinService,
  ) {}

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
        pin: dto.pin,
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

  /**
   * The person's kitchen PIN: one for every store they work at in the
   * brand, 6 digits, not a first guess (400 `KDS_PIN_FORMAT` /
   * `KDS_PIN_TOO_SIMPLE`), not used by anybody else at the brand (409
   * `KDS_PIN_TAKEN`). Replaces the PIN they had — an old store-scoped one
   * too — and ends their kitchen tablet sessions.
   */
  @Put(':userId/kds-pin')
  @ApiQuery({ name: 'brandId', required: false })
  setKdsPin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: SetStaffPinDto,
    @Query('brandId') brandId?: string,
  ): Promise<StaffMember> {
    this.kdsPins.assertNewPinAllowed(dto.pin);
    return this.staff.setKdsPin(userId, dto.pin, user, brandId || undefined);
  }

  /** «Сбросить PIN»: the person no longer unlocks the tablet, and their tablet sessions end. */
  @Delete(':userId/kds-pin')
  @ApiQuery({ name: 'brandId', required: false })
  clearKdsPin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Query('brandId') brandId?: string,
  ): Promise<StaffMember> {
    return this.staff.clearKdsPin(userId, user, brandId || undefined);
  }

  /**
   * A way into the cabinet for kitchen staff invited with a PIN only: an
   * email or a login and a temporary password. 409 `STAFF_HAS_SIGN_IN` for
   * someone who already has one. Owners and platform admins only.
   */
  @Put(':userId/sign-in')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
  @ApiQuery({ name: 'brandId', required: false })
  addSignIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: AddStaffSignInDto,
    @Query('brandId') brandId?: string,
  ): Promise<StaffInviteResult> {
    return this.staff.addSignIn(
      userId,
      { email: dto.email, login: dto.login, tempPassword: dto.tempPassword },
      user,
      brandId || undefined,
    );
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
