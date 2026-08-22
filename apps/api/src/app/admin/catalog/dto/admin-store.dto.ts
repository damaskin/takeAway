import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Currency, PickupPointType, StoreFulfillment, StoreStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkingHourInputDto {
  @ApiProperty({ description: '0 = Sunday, 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({ description: 'Minutes since local midnight' })
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  opensAt!: number;

  @ApiProperty({ description: 'Minutes since local midnight' })
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  closesAt!: number;

  @ApiPropertyOptional()
  @IsOptional()
  isClosed?: boolean;
}

export class CreateStoreDto {
  @ApiProperty()
  @IsString()
  brandId!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 80)
  slug!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty()
  @IsString()
  addressLine!: string;

  @ApiProperty()
  @IsString()
  city!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2' })
  @IsString()
  @Length(2, 2)
  country!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiProperty({ default: 'UTC' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: StoreStatus })
  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;

  @ApiProperty({ enum: StoreFulfillment, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(StoreFulfillment, { each: true })
  fulfillmentTypes!: StoreFulfillment[];

  @ApiProperty({ enum: PickupPointType })
  @IsEnum(PickupPointType)
  pickupPointType!: PickupPointType;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderCents?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 3600,
    description: 'Fixed per-order overhead in seconds. The queue wait is added on top.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  baseEtaSeconds?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    description: 'Orders this kitchen genuinely works at once. Drives how fast a rush drains.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  kitchenParallelism?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description: 'Most handovers this store will promise inside one 15-minute slot.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  slotCapacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  heroImageUrl?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  galleryUrls?: string[];

  @ApiPropertyOptional({ type: [WorkingHourInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourInputDto)
  workingHours?: WorkingHourInputDto[];
}

export class UpdateStoreDto extends PartialType(CreateStoreDto) {}

export class ReplaceWorkingHoursDto {
  @ApiProperty({ type: [WorkingHourInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkingHourInputDto)
  hours!: WorkingHourInputDto[];
}
