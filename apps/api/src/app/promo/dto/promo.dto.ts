import { ApiProperty } from '@nestjs/swagger';
import { Currency, PromoStatus, PromoType } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

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
  @ApiProperty({ enum: PromoStatus }) status!: PromoStatus;
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty() redemptionsCount!: number;
}

export class ValidatePromoDto {
  @ApiProperty() @IsString() @Length(2, 32) @Matches(/^[A-Za-z0-9_-]+$/) code!: string;
  @ApiProperty() @IsString() brandId!: string;
  @ApiProperty() @IsInt() @Min(0) subtotalCents!: number;
}

export class ValidPromoResultDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ required: false, nullable: true }) reason!: string | null;
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
  @ApiProperty({ enum: PromoStatus, required: false })
  @IsOptional()
  @IsEnum(PromoStatus)
  status?: PromoStatus;
  @ApiProperty({ enum: Currency, required: false }) @IsOptional() @IsEnum(Currency) currency?: Currency;
}

export class UpdatePromoStatusDto {
  @ApiProperty({ enum: PromoStatus }) @IsEnum(PromoStatus) status!: PromoStatus;
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
