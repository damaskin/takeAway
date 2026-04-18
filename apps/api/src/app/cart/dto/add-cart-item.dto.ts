import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty()
  @IsString()
  storeId!: string;

  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1, maximum: 99, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variationIds?: string[];

  @ApiPropertyOptional({
    description: 'Map { modifierId: count }. Omitted modifiers are treated as 0.',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  modifiers?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCartItemDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variationIds?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  modifiers?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// Keep the decorators referenced so tree-shakers don't drop them
void ValidateNested;
