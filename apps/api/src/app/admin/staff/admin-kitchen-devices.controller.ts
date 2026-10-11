import { BadRequestException, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { KitchenDeviceSummaryDto, KitchenPairingCodeDto } from '../../auth/dto/kitchen-device.dto';
import { KitchenDeviceService } from '../../auth/services/kitchen-device.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/**
 * The brand's kitchen tablets on the Staff page: which are bound, a one-time
 * link to bind one more, and unbinding. See KitchenDeviceService.
 */
@ApiTags('admin: staff')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
@Controller('admin/kitchen-devices')
export class AdminKitchenDevicesController {
  constructor(private readonly devices: KitchenDeviceService) {}

  @Get()
  @ApiQuery({ name: 'brandId', required: true })
  @ApiOkResponse({ type: KitchenDeviceSummaryDto, isArray: true })
  list(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string): Promise<KitchenDeviceSummaryDto[]> {
    return this.devices.list(user, requireBrand(brandId));
  }

  /** A one-time code; the admin turns it into `/login/pin?pair=<code>` to open on the tablet. */
  @Post('pairing-code')
  @ApiQuery({ name: 'brandId', required: true })
  @ApiOkResponse({ type: KitchenPairingCodeDto })
  pairingCode(
    @CurrentUser() user: AuthenticatedUser,
    @Query('brandId') brandId?: string,
  ): Promise<KitchenPairingCodeDto> {
    return this.devices.createPairingCode(user, requireBrand(brandId));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'brandId', required: true })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('brandId') brandId?: string,
  ): Promise<void> {
    await this.devices.revoke(user, requireBrand(brandId), id);
  }
}

function requireBrand(brandId: string | undefined): string {
  if (!brandId) throw new BadRequestException('brandId is required');
  return brandId;
}
