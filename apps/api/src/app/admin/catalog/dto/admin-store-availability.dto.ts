import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class SetIngredientStopDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When the ingredient comes back by itself (e.g. the end of the day); omitted = until switched on',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

/** A store-local stop that still holds; `expiresAt` null = until switched back on. */
export class AvailabilityStopDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
}

export class AvailabilityProductDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  categoryId!: string;

  @ApiProperty()
  categoryName!: string;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ type: AvailabilityStopDto, nullable: true, description: 'Null = on sale in this store' })
  stop!: AvailabilityStopDto | null;
}

export class AvailabilityIngredientDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'False = switched off for the whole brand in the ingredient library' })
  isAvailable!: boolean;

  @ApiProperty({ type: AvailabilityStopDto, nullable: true, description: 'Null = not stopped in this store' })
  stop!: AvailabilityStopDto | null;

  @ApiProperty({ type: [String], description: 'Products of this store with options made of it' })
  productNames!: string[];
}

/** What a store sells right now: the stop-list screen of the admin. */
export class StoreAvailabilityDto {
  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  storeName!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ type: [AvailabilityProductDto] })
  products!: AvailabilityProductDto[];

  @ApiProperty({ type: [AvailabilityIngredientDto] })
  ingredients!: AvailabilityIngredientDto[];
}
