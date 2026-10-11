import { ApiPropertyOptional } from '@nestjs/swagger';
import { StoreKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ListStoresQueryDto {
  @ApiPropertyOptional({ description: 'Latitude of the query point (WGS84)' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitude of the query point (WGS84)' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ description: 'Search radius in meters', minimum: 100, maximum: 50000, default: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(50000)
  radius?: number;

  @ApiPropertyOptional({
    enum: StoreKind,
    description: 'Only stores that sell this: FOOD for places to eat, COFFEE for coffee shops. A store can be both.',
  })
  @IsOptional()
  @IsEnum(StoreKind)
  kind?: StoreKind;
}
