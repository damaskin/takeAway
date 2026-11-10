import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@prisma/client';
import type {
  BrandTakeawayPromoOrder,
  BrandTakeawayPromoReport,
  CreateTakeawayPromoInput,
  CustomerBonus,
  TakeawayDebtReport,
  TakeawayDebtRow,
  TakeawayDebtStatus,
  TakeawayPromo,
  TakeawayPromoBrandRow,
  TakeawayPromoDayRow,
  TakeawayPromoEffectiveStatus,
  TakeawayPromoLine,
  TakeawayPromoReport,
  TakeawayPromoStatus,
  TakeawayPromoStoreRow,
  UpdateTakeawayPromoInput,
  UpdateTakeawayPromoStatusInput,
} from '@takeaway/shared-types';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * «Акции takeAway» (docs/takeaway-promos.md). The percent, the budget and
 * the dates are checked by the service, so a wrong one answers with its
 * stable code (TAKEAWAY_PROMO_PERCENT, _BUDGET, _DATES) rather than the
 * generic validation error.
 */

const STATUSES: TakeawayPromoStatus[] = ['ACTIVE', 'DISABLED', 'EXHAUSTED'];
const EFFECTIVE: TakeawayPromoEffectiveStatus[] = ['SCHEDULED', 'ACTIVE', 'ENDED', 'DISABLED', 'EXHAUSTED'];
const DEBT_STATUSES: TakeawayDebtStatus[] = ['ACCRUED', 'IN_PAYOUT', 'REPAID'];
const CODE = /^[A-Za-z0-9_-]+$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ── Requests ────────────────────────────────────────────────────────────────

export class CreateTakeawayPromoDto implements CreateTakeawayPromoInput {
  @ApiProperty({ maxLength: 120, example: 'Приветственный бонус' })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ minLength: 2, maxLength: 32, description: 'Letters, digits, _ and -; stored uppercase.' })
  @Transform(trim)
  @IsString()
  @Length(2, 32)
  @Matches(CODE, { message: 'code may hold only letters, digits, _ and -' })
  code!: string;

  @ApiProperty({ minimum: 1, maximum: 99 })
  @IsInt()
  percent!: number;

  @ApiProperty({ example: '2026-11-10T00:00:00Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ example: '2026-12-31T23:59:59Z' })
  @IsDateString()
  endsAt!: string;

  @ApiProperty({ enum: Currency, description: 'The promo works at stores selling in it.' })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiProperty({ minimum: 1, description: 'Minor units of `currency`.' })
  @IsInt()
  budgetCents!: number;

  @ApiPropertyOptional({ description: 'Handed out on sign-up. At most one live welcome promo at a time.' })
  @IsOptional()
  @IsBoolean()
  isWelcome?: boolean;
}

/** Before the first use everything may change; after it only name, end and budget (409 TAKEAWAY_PROMO_USED). */
export class UpdateTakeawayPromoDto implements UpdateTakeawayPromoInput {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 32 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 32)
  @Matches(CODE, { message: 'code may hold only letters, digits, _ and -' })
  code?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @IsInt()
  percent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({ enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ minimum: 1, description: 'Never below what was spent.' })
  @IsOptional()
  @IsInt()
  budgetCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isWelcome?: boolean;
}

export class UpdateTakeawayPromoStatusDto implements UpdateTakeawayPromoStatusInput {
  @ApiProperty({
    enum: ['ACTIVE', 'DISABLED'],
    description: 'Switch off, or back on — an exhausted promo only once its budget has room again.',
  })
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';
}

// ── Responses ───────────────────────────────────────────────────────────────

export class TakeawayPromoDto implements TakeawayPromo {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() percent!: number;
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() budgetCents!: number;
  @ApiProperty({ description: 'Discounts of the orders holding the promo.' }) spentCents!: number;
  @ApiProperty({ description: 'budget − spent' }) leftCents!: number;
  @ApiProperty({ enum: STATUSES }) status!: TakeawayPromoStatus;
  @ApiProperty({ enum: EFFECTIVE, description: 'An ACTIVE promo reads SCHEDULED before its start, ENDED after it.' })
  effectiveStatus!: TakeawayPromoEffectiveStatus;
  @ApiProperty() isWelcome!: boolean;
  @ApiProperty() redemptionsCount!: number;
  @ApiProperty({ description: 'Nobody used it yet: every field may change.' }) editable!: boolean;
  @ApiProperty() createdAt!: string;
}

export class TakeawayPromoBrandRowDto implements TakeawayPromoBrandRow {
  @ApiProperty() brandId!: string;
  @ApiProperty() brandName!: string;
  @ApiProperty() orders!: number;
  @ApiProperty() menuTotalCents!: number;
  @ApiProperty() discountCents!: number;
}

export class TakeawayPromoStoreRowDto extends TakeawayPromoBrandRowDto implements TakeawayPromoStoreRow {
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
}

export class TakeawayPromoDayRowDto implements TakeawayPromoDayRow {
  @ApiProperty({ description: 'UTC day.' }) date!: string;
  @ApiProperty() orders!: number;
  @ApiProperty() discountCents!: number;
}

export class TakeawayPromoReportDto implements TakeawayPromoReport {
  @ApiProperty({ type: TakeawayPromoDto }) promo!: TakeawayPromoDto;
  @ApiProperty({ description: 'Counted orders: paid by card or accepted, not cancelled.' }) orders!: number;
  @ApiProperty() customers!: number;
  @ApiProperty() menuTotalCents!: number;
  @ApiProperty() discountCents!: number;
  @ApiProperty({ type: [TakeawayPromoBrandRowDto] }) byBrand!: TakeawayPromoBrandRowDto[];
  @ApiProperty({ type: [TakeawayPromoStoreRowDto] }) byStore!: TakeawayPromoStoreRowDto[];
  @ApiProperty({ type: [TakeawayPromoDayRowDto] }) byDay!: TakeawayPromoDayRowDto[];
}

export class TakeawayDebtRowDto implements TakeawayDebtRow {
  @ApiProperty() brandId!: string;
  @ApiProperty() brandName!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() accruedCents!: number;
  @ApiProperty() repaidCents!: number;
  @ApiProperty() inPayoutCents!: number;
  @ApiProperty({ description: 'accrued − repaid' }) debtCents!: number;
}

export class TakeawayDebtTotalDto {
  @ApiProperty() currency!: string;
  @ApiProperty() accruedCents!: number;
  @ApiProperty() repaidCents!: number;
  @ApiProperty() inPayoutCents!: number;
  @ApiProperty() debtCents!: number;
}

export class TakeawayDebtReportDto implements TakeawayDebtReport {
  @ApiProperty({ type: [TakeawayDebtRowDto] }) rows!: TakeawayDebtRowDto[];
  @ApiProperty({ type: [TakeawayDebtTotalDto], description: 'Per currency, never summed across.' })
  totals!: TakeawayDebtTotalDto[];
}

export class BrandTakeawayPromoOrderDto implements BrandTakeawayPromoOrder {
  @ApiProperty() orderId!: string;
  @ApiProperty() orderCode!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty({ description: 'When the order counted (accepted, or first captured).' }) settledAt!: string;
  @ApiProperty() promoName!: string;
  @ApiProperty() percent!: number;
  @ApiProperty() menuTotalCents!: number;
  @ApiProperty() paidByGuestCents!: number;
  @ApiProperty() compensationCents!: number;
  @ApiProperty({ enum: DEBT_STATUSES }) status!: TakeawayDebtStatus;
  @ApiProperty({ type: String, nullable: true }) payoutId!: string | null;
  @ApiProperty({ type: String, nullable: true }) repaidAt!: string | null;
}

class BrandTakeawayPromoPeriodDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() timeZone!: string;
}

export class BrandTakeawayPromoReportDto implements BrandTakeawayPromoReport {
  @ApiProperty() brandId!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: BrandTakeawayPromoPeriodDto }) period!: BrandTakeawayPromoPeriodDto;
  @ApiProperty() orders!: number;
  @ApiProperty() menuTotalCents!: number;
  @ApiProperty() paidByGuestCents!: number;
  @ApiProperty() compensationAccruedCents!: number;
  @ApiProperty() compensationRepaidCents!: number;
  @ApiProperty({ description: 'accrued − repaid over all time, now.' }) currentDebtCents!: number;
  @ApiProperty({ type: [BrandTakeawayPromoOrderDto] }) items!: BrandTakeawayPromoOrderDto[];
}

/** «Акция takeAway −10%: гость оплатил 90,00, ещё 10,00 компенсирует takeAway». */
export class TakeawayPromoLineDto implements TakeawayPromoLine {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() percent!: number;
  @ApiProperty({ description: 'P — the order at menu prices.' }) menuTotalCents!: number;
  @ApiProperty({ description: 'D — paid by takeAway to the venue; part of the order’s discountCents.' })
  discountCents!: number;
  @ApiProperty({ description: 'P − D' }) paidByGuestCents!: number;
}

export class CustomerBonusDto implements CustomerBonus {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['WELCOME'] }) kind!: 'WELCOME';
  @ApiProperty() promoId!: string;
  @ApiProperty({ description: 'Goes into the promo field at checkout.' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() percent!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() expiresAt!: string;
}
