import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

const VARIATION_IDS_DOC =
  'At most one per variation type (SIZE, MILK, ...). A type left out gets its default — the one ' +
  'marked default, else the first on the menu. An id the product does not have is a 400.';

const MODIFIERS_DOC =
  "Map { modifierId: count }. Omitted modifiers count as 0; counts are clamped to the modifier's " +
  'min/max. An id the product does not have, with a positive count, is a 400.';

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

  @ApiPropertyOptional({ type: [String], description: VARIATION_IDS_DOC })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variationIds?: string[];

  @ApiPropertyOptional({ description: MODIFIERS_DOC, type: Object })
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

  @ApiPropertyOptional({ type: [String], description: VARIATION_IDS_DOC })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variationIds?: string[];

  @ApiPropertyOptional({ description: MODIFIERS_DOC, type: Object })
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
