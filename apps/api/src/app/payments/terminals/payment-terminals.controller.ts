import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type {
  PaymentTerminalCheckResult,
  PaymentTerminalStatus,
  PaymentTerminalView,
  UpsertPaymentTerminalRequest,
} from '@takeaway/shared-types';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BrandScopeService } from '../../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PaymentTerminalsAdminService } from './payment-terminals-admin.service';

const PEM_MAX = 20_000;

/** Every field optional: left out — kept; `null` or `''` — cleared; a value — set. */
export class UpsertPaymentTerminalDto implements UpsertPaymentTerminalRequest {
  @ApiPropertyOptional({ example: 'M00012345' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cardMerchantId?: string | null;

  @ApiPropertyOptional({ example: 'E1016682' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cardTerminalId?: string | null;

  @ApiPropertyOptional({ description: 'PEM, unencrypted. Write-only.' })
  @IsOptional()
  @IsString()
  @MaxLength(PEM_MAX)
  cardPrivateKey?: string | null;

  @ApiPropertyOptional({ description: 'The merchant certificate the bank issued for the key, PEM' })
  @IsOptional()
  @IsString()
  @MaxLength(PEM_MAX)
  cardCertificate?: string | null;

  @ApiPropertyOptional({ description: 'Only if the bank signs this merchant’s answers with its own certificate' })
  @IsOptional()
  @IsString()
  @MaxLength(PEM_MAX)
  cardBankCertificate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  webMerchantLogin?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to the login' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  webMerchantId?: string | null;

  @ApiPropertyOptional({ description: 'Write-only' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  webMerchantPass?: string | null;

  @ApiPropertyOptional({ description: 'PEM; unset — the Web-платёж bank certificate from env' })
  @IsOptional()
  @IsString()
  @MaxLength(PEM_MAX)
  webBankCertificate?: string | null;

  @ApiPropertyOptional({ example: 'QRT000000000000123' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  qrTerminalId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  qrLogin?: string | null;

  @ApiPropertyOptional({ description: 'Write-only' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  qrPassword?: string | null;

  @ApiPropertyOptional({ description: 'Replaces login and password when the bank issues one. Write-only.' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  qrExternalToken?: string | null;

  @ApiPropertyOptional({
    description: 'The device id the bank issues for payment notifications (DeviceId); empty — -1.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  qrDeviceId?: string | null;

  @ApiPropertyOptional({ description: 'The terminal allows preauthorization (hold at checkout, capture on accept)' })
  @IsOptional()
  @IsBoolean()
  holdUntilAccepted?: boolean;

  @ApiPropertyOptional({ description: 'The bank’s test mode on card requests' })
  @IsOptional()
  @IsBoolean()
  isTest?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/**
 * A brand's own Agroprombank terminal (docs/agroprombank-payments.md §13).
 * Entering and reading it is the platform team's (SUPER_ADMIN); the brand's
 * own roles see only whether it is connected (`status`).
 */
@ApiTags('admin: brands')
@ApiBearerAuth()
@Controller('admin/brands/:brandId/payment-terminal')
export class PaymentTerminalsController {
  constructor(
    private readonly terminals: PaymentTerminalsAdminService,
    private readonly brandScope: BrandScopeService,
  ) {}

  /** Masked: secrets come back as «задан / не задан» and their last four characters. */
  @Get()
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ description: 'PaymentTerminalView' })
  view(@Param('brandId') brandId: string): Promise<PaymentTerminalView> {
    return this.terminals.view(brandId);
  }

  @Put()
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ description: 'PaymentTerminalView' })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('brandId') brandId: string,
    @Body() dto: UpsertPaymentTerminalDto,
  ): Promise<PaymentTerminalView> {
    return this.terminals.upsert(brandId, dto, user.id);
  }

  /** Back to takeAway's default terminal for new payments; refunds of earlier ones still go through this one. */
  @Delete()
  @Roles(Role.SUPER_ADMIN)
  @ApiOkResponse({ description: 'PaymentTerminalView' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('brandId') brandId: string): Promise<PaymentTerminalView> {
    return this.terminals.remove(brandId, user.id);
  }

  /** «Проверить подключение»: read-only status lookups, nothing is charged or held. */
  @Post('check')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'PaymentTerminalCheckResult' })
  check(@Param('brandId') brandId: string): Promise<PaymentTerminalCheckResult> {
    return this.terminals.check(brandId);
  }

  /** Connected or not — for the brand's own roles. */
  @Get('status')
  @Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
  @ApiOkResponse({ description: 'PaymentTerminalStatus' })
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('brandId') brandId: string,
  ): Promise<PaymentTerminalStatus> {
    await this.brandScope.assertBrand(user, brandId);
    return this.terminals.status(brandId);
  }
}
