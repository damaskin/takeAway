import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, PromoStatus, PromoType } from '@prisma/client';
import type { PromoErrorCode } from '@takeaway/shared-types';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

import { INACTIVE_DAYS } from '../../customers/customer-segment';

export class PromoDto {
  @ApiProperty() id!: string;
  @ApiProperty() brandId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: PromoType }) type!: PromoType;
  @ApiProperty() value!: number;
  @ApiProperty({ required: false, nullable: true }) minSubtotalCents!: number | null;
  @ApiProperty() maxRedemptions!: number;
  @ApiProperty() perUserLimit!: number;
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  /** In effect now: an active promo reads SCHEDULED before its start and EXPIRED after its end. */
  @ApiProperty({ enum: PromoStatus }) status!: PromoStatus;
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty() redemptionsCount!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Only for customers with 3+ orders and none for this many days; null — anyone',
  })
  inactiveDays!: number | null;
  @ApiProperty({ nullable: true, type: String, description: 'With inactiveDays: only orders at this store count' })
  segmentStoreId!: string | null;
}

export class ValidatePromoDto {
  @ApiProperty() @IsString() @Length(2, 32) @Matches(/^[A-Za-z0-9_-]+$/) code!: string;
  @ApiProperty() @IsString() brandId!: string;
  @ApiProperty() @IsInt() @Min(0) subtotalCents!: number;
}

export class ValidPromoResultDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ required: false, nullable: true }) reason!: string | null;
  /** Why the code does not apply, as a stable code clients translate. Null when valid. */
  @ApiProperty({ required: false, nullable: true, type: String }) reasonCode!: PromoErrorCode | null;
  /** PROMO_MIN_ORDER: the promo's minimum subtotal, in `currency`. */
  @ApiProperty({ required: false }) minOrderCents?: number;
  @ApiProperty({ required: false }) currency?: string;
  @ApiProperty({ type: () => PromoDto, required: false, nullable: true })
  promo!: PromoDto | null;
  @ApiProperty() discountCents!: number;
  @ApiProperty() pointsMultiplier!: number;
}

export class CreatePromoDto {
  @ApiProperty() @IsString() brandId!: string;
  @ApiProperty() @IsString() @Length(2, 32) @Matches(/^[A-Za-z0-9_-]+$/) code!: string;
  @ApiProperty() @IsString() @Length(1, 120) label!: string;
  @ApiProperty({ enum: PromoType }) @IsEnum(PromoType) type!: PromoType;
  @ApiProperty() @IsInt() @Min(0) value!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) minSubtotalCents?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) maxRedemptions?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) perUserLimit?: number;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
  @ApiProperty({
    enum: [PromoStatus.DRAFT, PromoStatus.RUNNING, PromoStatus.SCHEDULED],
    required: false,
    description: 'DRAFT, or active from startsAt (RUNNING and SCHEDULED mean the same here)',
  })
  @IsOptional()
  @IsIn([PromoStatus.DRAFT, PromoStatus.RUNNING, PromoStatus.SCHEDULED])
  status?: PromoStatus;
  @ApiProperty({ enum: Currency, required: false }) @IsOptional() @IsEnum(Currency) currency?: Currency;
  @ApiPropertyOptional({ enum: INACTIVE_DAYS, description: 'Only for inactive customers: days without an order' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([...INACTIVE_DAYS])
  inactiveDays?: number;
  @ApiPropertyOptional({ description: 'With inactiveDays: only orders at this store of the brand count' })
  @IsOptional()
  @IsString()
  segmentStoreId?: string;
}

/**
 * Edits a promo that is still a draft, or scheduled or paused with no
 * redemptions. Omitted fields stay; null clears `minSubtotalCents`,
 * `inactiveDays` and `segmentStoreId`.
 */
export class UpdatePromoDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 32) @Matches(/^[A-Za-z0-9_-]+$/) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) label?: string;
  @ApiPropertyOptional({ enum: PromoType }) @IsOptional() @IsEnum(PromoType) type?: PromoType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) value?: number;
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  minSubtotalCents?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) maxRedemptions?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) perUserLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional({ enum: Currency }) @IsOptional() @IsEnum(Currency) currency?: Currency;
  @ApiPropertyOptional({ enum: INACTIVE_DAYS, nullable: true, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsIn([...INACTIVE_DAYS])
  inactiveDays?: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  segmentStoreId?: string | null;
}

export class UpdatePromoStatusDto {
  @ApiProperty({
    enum: PromoStatus,
    description: 'RUNNING starts or resumes (SCHEDULED until startsAt), PAUSED pauses, EXPIRED ends for good',
  })
  @IsEnum(PromoStatus)
  status!: PromoStatus;
}

/** Used when the checkout pipeline consumes a promo against an order. */
export class ApplyPromoInput {
  code!: string;
  brandId!: string;
  subtotalCents!: number;
  userId!: string;
}

export class ApplyPromoResultDto {
  @ApiProperty() discountCents!: number;
  @ApiProperty() pointsMultiplier!: number;
  @ApiProperty({ required: false, nullable: true }) promoId!: string | null;
  @ApiProperty({ required: false, nullable: true }) code!: string | null;

  /** Extras (optional helpers for M4+). */
  @ApiProperty({ required: false }) label?: string;
  @ApiProperty({ enum: PromoType, required: false }) type?: PromoType;

  @Max(Number.MAX_SAFE_INTEGER)
  static empty(): ApplyPromoResultDto {
    return { discountCents: 0, pointsMultiplier: 1, promoId: null, code: null };
  }
}
