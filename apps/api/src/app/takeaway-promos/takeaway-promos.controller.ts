import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateTakeawayPromoDto,
  CustomerBonusDto,
  TakeawayDebtReportDto,
  TakeawayPromoDto,
  TakeawayPromoReportDto,
  UpdateTakeawayPromoDto,
  UpdateTakeawayPromoStatusDto,
} from './dto/takeaway-promo.dto';
import { TakeawayPromoAdminService } from './takeaway-promo-admin.service';
import { WelcomeBonusService } from './welcome-bonus.service';

/**
 * «Акции takeAway» of the platform admin (docs/takeaway-promos.md §4.1):
 * percent discounts at every venue that takeAway pays for, and the debt they
 * leave to the brands. SUPER_ADMIN only.
 */
@ApiTags('admin: takeaway promos')
@ApiBearerAuth()
@Controller('admin/takeaway-promos')
@Roles(Role.SUPER_ADMIN)
export class TakeawayPromosController {
  constructor(private readonly promos: TakeawayPromoAdminService) {}

  @Get()
  @ApiOkResponse({ type: TakeawayPromoDto, isArray: true })
  list(): Promise<TakeawayPromoDto[]> {
    return this.promos.list();
  }

  @Post()
  @ApiOkResponse({ type: TakeawayPromoDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTakeawayPromoDto): Promise<TakeawayPromoDto> {
    return this.promos.create(dto, user.id);
  }

  /** takeAway's debt to every brand with promo orders, now. Declared before `:id`. */
  @Get('debt')
  @ApiOkResponse({ type: TakeawayDebtReportDto })
  debt(): Promise<TakeawayDebtReportDto> {
    return this.promos.debt();
  }

  @Get(':id')
  @ApiOkResponse({ type: TakeawayPromoDto })
  get(@Param('id') id: string): Promise<TakeawayPromoDto> {
    return this.promos.get(id);
  }

  /** Unused: everything; used: name, end and budget only (409 TAKEAWAY_PROMO_USED). */
  @Patch(':id')
  @ApiOkResponse({ type: TakeawayPromoDto })
  update(@Param('id') id: string, @Body() dto: UpdateTakeawayPromoDto): Promise<TakeawayPromoDto> {
    return this.promos.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOkResponse({ type: TakeawayPromoDto })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTakeawayPromoStatusDto): Promise<TakeawayPromoDto> {
    return this.promos.updateStatus(id, dto);
  }

  @Get(':id/report')
  @ApiOkResponse({ type: TakeawayPromoReportDto })
  report(@Param('id') id: string): Promise<TakeawayPromoReportDto> {
    return this.promos.report(id);
  }
}

/** The customer's bonuses — for now the welcome bonus while it can be used (§4.3). */
@ApiTags('takeaway promos')
@ApiBearerAuth()
@Controller()
export class CustomerBonusesController {
  constructor(private readonly welcome: WelcomeBonusService) {}

  @Get('me/bonuses')
  @ApiOkResponse({ type: CustomerBonusDto, isArray: true })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<CustomerBonusDto[]> {
    return this.welcome.listForUser(user.id);
  }
}
