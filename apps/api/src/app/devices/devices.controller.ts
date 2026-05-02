import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@Controller()
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly config: ConfigService,
  ) {}

  /** Public — clients fetch the VAPID public key before calling pushManager.subscribe. */
  @Public()
  @Get('devices/vapid-public-key')
  @ApiOkResponse({ schema: { properties: { key: { type: 'string', nullable: true } } } })
  vapidKey(): { key: string | null } {
    return { key: this.config.get<string>('VAPID_PUBLIC_KEY') ?? null };
  }

  @Post('devices')
  @ApiBearerAuth()
  @ApiOkResponse({ schema: { properties: { id: { type: 'string' } } } })
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto): Promise<{ id: string }> {
    return this.devices.register(user.id, dto);
  }

  @Delete('devices')
  @ApiBearerAuth()
  @HttpCode(204)
  unregister(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto): Promise<void> {
    return this.devices.unregister(user.id, dto);
  }
}
