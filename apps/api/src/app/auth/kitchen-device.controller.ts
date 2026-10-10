import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from './decorators/current-user.decorator';
import { KdsSessionAllowed } from './decorators/kds-session.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import {
  BindKitchenDeviceDto,
  KITCHEN_DEVICE_HEADER,
  KitchenDeviceBindingDto,
  KitchenDeviceStoresDto,
  RedeemKitchenPairingDto,
} from './dto/kitchen-device.dto';
import { KitchenDeviceService } from './services/kitchen-device.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_MULTIPLIER = IS_DEV ? 10 : 1;

/**
 * Binding a kitchen tablet to a brand, and what a bound tablet's PIN screen
 * may show. See KitchenDeviceService.
 */
@ApiTags('auth')
@Controller('auth/kds/device')
export class KitchenDeviceController {
  constructor(private readonly devices: KitchenDeviceService) {}

  /** The kitchen board binds the tablet a signed-in employee opened it on. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF)
  @KdsSessionAllowed({ from: 'body', key: 'storeId' })
  @ApiOkResponse({ type: KitchenDeviceBindingDto })
  bind(@CurrentUser() user: AuthenticatedUser, @Body() dto: BindKitchenDeviceDto): Promise<KitchenDeviceBindingDto> {
    return this.devices.bindForUser(user, dto.storeId);
  }

  /** A tablet opened the one-time link from the Staff page. */
  @Public()
  @Post('pair')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10 * DEV_MULTIPLIER, ttl: 60_000 } })
  @ApiOkResponse({ type: KitchenDeviceBindingDto })
  @ApiUnauthorizedResponse({ description: 'KDS_PAIRING_INVALID — unknown, used or expired link' })
  pair(@Body() dto: RedeemKitchenPairingDto): Promise<KitchenDeviceBindingDto> {
    return this.devices.redeemPairingCode(dto.code);
  }

  /** The PIN screen's store picker: only the bound brand's stores where someone has a PIN. */
  @Public()
  @Get()
  @Throttle({ default: { limit: 30 * DEV_MULTIPLIER, ttl: 60_000 } })
  @ApiHeader({ name: KITCHEN_DEVICE_HEADER, required: true, description: 'The tablet token' })
  @ApiOkResponse({ type: KitchenDeviceStoresDto })
  @ApiUnauthorizedResponse({ description: 'KDS_DEVICE_UNKNOWN — the tablet is not (or no longer) bound' })
  stores(@Headers(KITCHEN_DEVICE_HEADER) token?: string): Promise<KitchenDeviceStoresDto> {
    return this.devices.storesFor(token);
  }
}
