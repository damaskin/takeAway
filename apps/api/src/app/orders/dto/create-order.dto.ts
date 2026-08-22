import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfillmentType, PickupMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Gift card code, applied as a discount.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  giftCardCode?: string;

  @ApiPropertyOptional({
    description:
      'Loyalty points to spend. Clamped server-side to the balance and to the order value — never trusted as sent.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  pointsToSpend?: number;

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
