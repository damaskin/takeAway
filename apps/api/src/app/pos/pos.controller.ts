import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PosProvider, PosSyncJobKind, Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ConnectPosDto } from './dto/connect-pos.dto';
import { PosIntegrationDto, PosSyncJobDto } from './dto/pos-status.dto';
import { PosService } from './pos.service';

@ApiTags('admin: pos')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
@Controller('admin/pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('status')
  @ApiOkResponse({ type: PosIntegrationDto, isArray: true })
  @ApiQuery({ name: 'brandId', required: false })
  status(@CurrentUser() user: AuthenticatedUser, @Query('brandId') brandId?: string): Promise<PosIntegrationDto[]> {
    return this.pos.getStatus(user, brandId);
  }

  @Post('connect')
  @ApiOkResponse({ type: PosIntegrationDto })
  @ApiQuery({ name: 'brandId', required: false })
  connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectPosDto,
    @Query('brandId') brandId?: string,
  ): Promise<PosIntegrationDto> {
    return this.pos.connect(user, {
      provider: dto.provider,
      credentials: dto.credentials,
      settings: dto.settings,
      brandId,
    });
  }

  @Delete('disconnect/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'brandId', required: false })
  async disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: PosProvider,
    @Query('brandId') brandId?: string,
  ): Promise<void> {
    await this.pos.disconnect(user, provider, brandId);
  }

  @Post('sync/stores/:provider')
  @ApiOkResponse({ type: PosSyncJobDto })
  @ApiQuery({ name: 'brandId', required: false })
  syncStores(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: PosProvider,
    @Query('brandId') brandId?: string,
  ): Promise<PosSyncJobDto> {
    return this.pos.enqueueSync(user, provider, PosSyncJobKind.STORES, brandId);
  }

  @Post('sync/menu/:provider')
  @ApiOkResponse({ type: PosSyncJobDto })
  @ApiQuery({ name: 'brandId', required: false })
  syncMenu(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: PosProvider,
    @Query('brandId') brandId?: string,
  ): Promise<PosSyncJobDto> {
    return this.pos.enqueueSync(user, provider, PosSyncJobKind.MENU, brandId);
  }

  @Post('sync/stop-list/:provider')
  @ApiOkResponse({ type: PosSyncJobDto })
  @ApiQuery({ name: 'brandId', required: false })
  syncStopList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: PosProvider,
    @Query('brandId') brandId?: string,
  ): Promise<PosSyncJobDto> {
    return this.pos.enqueueSync(user, provider, PosSyncJobKind.STOP_LIST, brandId);
  }

  @Get('jobs/:provider')
  @ApiOkResponse({ type: PosSyncJobDto, isArray: true })
  @ApiQuery({ name: 'brandId', required: false })
  jobs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: PosProvider,
    @Query('brandId') brandId?: string,
  ): Promise<PosSyncJobDto[]> {
    return this.pos.listJobs(user, provider, brandId);
  }
}
