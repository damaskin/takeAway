import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { OptionSelectionDto } from '../../option-groups/dto/option-groups.dto';

const VARIATION_IDS_DOC =
  'At most one per variation type (SIZE, MILK, ...). A type left out gets its default — the one ' +
  'marked default, else the first on the menu. An id the product does not have is a 400.';

const MODIFIERS_DOC =
  "Map { modifierId: count }. Omitted modifiers count as 0; counts are clamped to the modifier's " +
  'min/max. An id the product does not have, with a positive count, is a 400.';

const OPTIONS_DOC =
  'Picks from the options catalog, for a product with catalog groups (then variationIds and modifiers are ' +
  'ignored). Omitted: on add, every default — 400 OPTIONS_REQUIRED when that is not a valid choice; on update, ' +
  'the picks the line has. A choice that breaks a rule is 400 OPTIONS_INVALID with `errors`.';

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

  @ApiPropertyOptional({ type: [OptionSelectionDto], description: OPTIONS_DOC })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OptionSelectionDto)
  options?: OptionSelectionDto[];

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

  @ApiPropertyOptional({ type: [OptionSelectionDto], description: OPTIONS_DOC })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OptionSelectionDto)
  options?: OptionSelectionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
