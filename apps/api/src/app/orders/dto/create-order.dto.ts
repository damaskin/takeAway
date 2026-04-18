import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfillmentType, PickupMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
