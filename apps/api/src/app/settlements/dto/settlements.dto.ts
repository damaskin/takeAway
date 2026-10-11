import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import type {
  CommissionRateEntry,
  CommissionRateHistory,
  CommissionRateSource,
  PayoutBlockReason,
  PayoutStatus,
  SettlementBalance,
  SettlementDay,
  SettlementPayout,
  SettlementPayoutPreview,
  SettlementRateSpan,
  SettlementReport,
  SettlementTotals,
} from '@takeaway/shared-types';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { ISO_DAY } from '../../analytics/analytics-range';

const CURRENCIES = Object.values(Currency);
const DAY_MESSAGE = (field: string) => `${field} must be a date like 2026-10-04`;

/** Optional text: blank is the same as left out. */
const trimOrDrop = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

// ── Requests ────────────────────────────────────────────────────────────────

export class SettlementQueryDto {
  @ApiPropertyOptional({ description: 'SUPER_ADMIN: required. A brand owner: one of theirs, their own by default.' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({ enum: CURRENCIES, description: "Defaults to the brand's currency. Never summed across." })
  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: "First day, in the brand's time zone." })
  @IsOptional()
  @Matches(ISO_DAY, { message: DAY_MESSAGE('from') })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-07', description: 'Last day, included.' })
  @IsOptional()
  @Matches(ISO_DAY, { message: DAY_MESSAGE('to') })
  to?: string;

  @ApiPropertyOptional({ description: 'Days ending today, when from/to are not given.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;
}

export class SettlementBrandQueryDto {
  @ApiPropertyOptional({ description: 'SUPER_ADMIN: required. A brand owner: their own by default.' })
  @IsOptional()
  @IsString()
  brandId?: string;
}

export class SetCommissionRateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  brandId!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 5000,
    description: "Basis points (1250 = 12.5 %). Null or left out: back to the plan's rate.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(5000)
  bps?: number | null;

  @ApiProperty({ example: '2026-11-01', description: "The day the rate starts, in the brand's time zone." })
  @Matches(ISO_DAY, { message: DAY_MESSAGE('effectiveFrom') })
  effectiveFrom!: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Where the terms come from: the agreement, the e-mail.' })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreatePayoutDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  brandId!: string;

  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency!: string;

  @ApiProperty({ example: '2026-10-07', description: 'Last day the payout settles; it must have ended.' })
  @Matches(ISO_DAY, { message: DAY_MESSAGE('to') })
  to!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class MarkPayoutPaidDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Bank transfer number.' })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({ example: '2026-10-09T10:00:00Z', description: 'When the money went out; now by default.' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;
}

// ── Responses ───────────────────────────────────────────────────────────────

const BLOCK_REASONS: PayoutBlockReason[] = ['PERIOD_OPEN', 'OVERLAP', 'NOTHING_DUE'];
const PAYOUT_STATUSES: PayoutStatus[] = ['PENDING', 'PAID'];
const RATE_SOURCES: CommissionRateSource[] = ['PLAN', 'INDIVIDUAL'];

export class SettlementTotalsDto implements SettlementTotals {
  @ApiProperty() orders!: number;
  @ApiProperty() cardOrders!: number;
  @ApiProperty() zeroTotalOrders!: number;
  @ApiProperty() unpaidOrders!: number;
  @ApiProperty() unpaidTotalCents!: number;
  @ApiProperty({ description: 'Line items before discounts.' }) salesCents!: number;
  @ApiProperty() promoDiscountCents!: number;
  @ApiProperty() pointsDiscountCents!: number;
  @ApiProperty() giftCardCents!: number;
  @ApiProperty() deliveryFeeCents!: number;
  @ApiProperty() capturedCents!: number;
  @ApiProperty() refundedCents!: number;
  @ApiProperty({ description: 'captured − refunded' }) commissionBaseCents!: number;
  @ApiProperty({ description: 'Rounded half up per order.' }) commissionCents!: number;
  @ApiProperty({ description: 'base − commission' }) payableCents!: number;
}

export class SettlementDayDto extends SettlementTotalsDto implements SettlementDay {
  @ApiProperty() date!: string;
}

export class SettlementRateSpanDto implements SettlementRateSpan {
  @ApiProperty() bps!: number;
  @ApiProperty({ enum: RATE_SOURCES }) source!: CommissionRateSource;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
}

export class SettlementBalanceDto implements SettlementBalance {
  @ApiProperty() openingCents!: number;
  @ApiProperty() payableCents!: number;
  @ApiProperty() paidCents!: number;
  @ApiProperty() pendingCents!: number;
  @ApiProperty() closingCents!: number;
  @ApiProperty() closingPendingCents!: number;
}

export class SettlementPayoutPreviewDto implements SettlementPayoutPreview {
  @ApiProperty({ type: String, nullable: true }) periodFrom!: string | null;
  @ApiProperty() periodTo!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() cardNetCents!: number;
  @ApiProperty() commissionCents!: number;
  @ApiProperty({ enum: BLOCK_REASONS, nullable: true }) blocked!: PayoutBlockReason | null;
  @ApiProperty({ type: String, nullable: true }) lastSettledDay!: string | null;
}

export class SettlementPayoutDto implements SettlementPayout {
  @ApiProperty() id!: string;
  @ApiProperty() brandId!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() periodFrom!: string;
  @ApiProperty() periodTo!: string;
  @ApiProperty() timeZone!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() cardNetCents!: number;
  @ApiProperty() commissionCents!: number;
  @ApiProperty({ enum: PAYOUT_STATUSES }) status!: PayoutStatus;
  @ApiProperty({ type: String, nullable: true }) paidAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
  @ApiProperty({ type: String, nullable: true }) comment!: string | null;
  @ApiProperty() createdAt!: string;
}

class SettlementBrandDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['BASIC', 'PRO'] }) plan!: 'BASIC' | 'PRO';
  @ApiProperty() currentBps!: number;
  @ApiProperty() planBps!: number;
}

class SettlementPeriodDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() days!: number;
  @ApiProperty() timeZone!: string;
}

export class SettlementReportDto implements SettlementReport {
  @ApiProperty({ type: SettlementBrandDto }) brand!: SettlementBrandDto;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [String] }) currencies!: string[];
  @ApiProperty({ type: SettlementPeriodDto }) period!: SettlementPeriodDto;
  @ApiProperty({ type: SettlementTotalsDto }) totals!: SettlementTotalsDto;
  @ApiProperty({ type: [SettlementDayDto] }) days!: SettlementDayDto[];
  @ApiProperty({ type: [SettlementRateSpanDto] }) rates!: SettlementRateSpanDto[];
  @ApiProperty({ type: SettlementBalanceDto }) balance!: SettlementBalanceDto;
  @ApiProperty({ type: SettlementPayoutPreviewDto }) nextPayout!: SettlementPayoutPreviewDto;
  @ApiProperty({ type: [SettlementPayoutDto] }) payouts!: SettlementPayoutDto[];
}

export class CommissionRateEntryDto implements CommissionRateEntry {
  @ApiProperty() id!: string;
  @ApiProperty() bps!: number;
  @ApiProperty({ enum: RATE_SOURCES }) source!: CommissionRateSource;
  @ApiProperty() effectiveFrom!: string;
  @ApiProperty({ type: String, nullable: true }) effectiveTo!: string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty() createdAt!: string;
}

export class CommissionRateHistoryDto implements CommissionRateHistory {
  @ApiProperty() brandId!: string;
  @ApiProperty({ enum: ['BASIC', 'PRO'] }) plan!: 'BASIC' | 'PRO';
  @ApiProperty() planBps!: number;
  @ApiProperty() currentBps!: number;
  @ApiProperty() timeZone!: string;
  @ApiProperty({ type: [CommissionRateEntryDto] }) rates!: CommissionRateEntryDto[];
}
