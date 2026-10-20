import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { StaffPasswordReset } from '@takeaway/shared-types';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AdminStaffMembersService } from './admin-staff-members.service';

/**
 * The brand owner's account, for the platform team. Setting the owner is
 * `PATCH /admin/brands/:id/owner` (AdminBrandsController); this resets the
 * owner's password, which nobody else can do on a server without mail.
 */
@ApiTags('admin: brands')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/brands/:brandId/owner')
export class AdminBrandOwnerController {
  constructor(private readonly staff: AdminStaffMembersService) {}

  /**
   * «Сбросить пароль» for the owner: a generated temporary password,
   * answered once, to be changed at the next sign-in; every session of the
   * owner ends; a link to set their own goes out when the server can send
   * mail (`resetEmail`).
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    schema: {
      properties: {
        tempPassword: { type: 'string' },
        resetEmail: { type: 'string', enum: ['SENT', 'NOT_CONFIGURED', 'FAILED', 'NO_EMAIL'] },
      },
    },
  })
  @ApiForbiddenResponse({ description: '`STAFF_NOT_EDITABLE` — the owner account is a platform admin.' })
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('brandId') brandId: string,
  ): Promise<StaffPasswordReset> {
    return this.staff.resetOwnerPassword(brandId, user);
  }
}
