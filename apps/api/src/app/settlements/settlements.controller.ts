import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CommissionRateHistoryDto,
  CreatePayoutDto,
  MarkPayoutPaidDto,
  SetCommissionRateDto,
  SettlementBrandQueryDto,
  SettlementPayoutDto,
  SettlementQueryDto,
  SettlementReportDto,
} from './dto/settlements.dto';
import { SettlementsService } from './settlements.service';

/**
 * «Расчёты с брендами». A platform admin reads any brand and is the only one
 * who changes rates or fixes and pays out; a brand owner reads the same
 * figures for their own brand — the scope comes from the account.
 */
@ApiTags('admin: settlements')
@ApiBearerAuth()
@Controller('admin/settlements')
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN)
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @ApiOkResponse({ type: SettlementReportDto })
  report(@CurrentUser() user: AuthenticatedUser, @Query() query: SettlementQueryDto): Promise<SettlementReportDto> {
    return this.settlements.report(user, query);
  }

  @Get('rates')
  @ApiOkResponse({ type: CommissionRateHistoryDto })
  rates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SettlementBrandQueryDto,
  ): Promise<CommissionRateHistoryDto> {
    return this.settlements.rates(user, query.brandId);
  }

  @Post('rates')
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ type: CommissionRateHistoryDto })
  setRate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetCommissionRateDto,
  ): Promise<CommissionRateHistoryDto> {
    return this.settlements.setRate(user, dto);
  }

  @Delete('rates/:id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ type: CommissionRateHistoryDto })
  deleteRate(@Param('id') id: string): Promise<CommissionRateHistoryDto> {
    return this.settlements.deleteRate(id);
  }

  @Post('payouts')
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ type: SettlementPayoutDto })
  createPayout(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePayoutDto): Promise<SettlementPayoutDto> {
    return this.settlements.createPayout(user, dto);
  }

  @Patch('payouts/:id/paid')
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ type: SettlementPayoutDto })
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MarkPayoutPaidDto,
  ): Promise<SettlementPayoutDto> {
    return this.settlements.markPaid(user, id, dto);
  }

  @Delete('payouts/:id')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  deletePayout(@Param('id') id: string): Promise<void> {
    return this.settlements.deletePayout(id);
  }
}
