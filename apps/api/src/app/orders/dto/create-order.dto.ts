import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfillmentType, PickupMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  cartId!: string;

  @ApiProperty({ enum: PickupMode })
  @IsEnum(PickupMode)
  pickupMode!: PickupMode;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Required when pickupMode = SCHEDULED' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  pickupAt?: Date;

  @ApiPropertyOptional({ enum: FulfillmentType, default: FulfillmentType.PICKUP })
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  couponCode?: string;

  // ── Delivery fields (required when fulfillmentType === 'DELIVERY') ──────

  @ApiPropertyOptional({ description: 'Street line. Required for DELIVERY orders.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deliveryAddressLine?: string;

  @ApiPropertyOptional({ description: 'City. Required for DELIVERY orders.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  deliveryCity?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  deliveryLatitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  deliveryLongitude?: number;

  @ApiPropertyOptional({ description: 'Extra notes for the rider (building entrance, code, etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryNotes?: string;
}
