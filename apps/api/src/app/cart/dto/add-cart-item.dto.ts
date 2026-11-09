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

const ADD_OPTIONS_DOC =
  'Picks from the options catalog, for a product with catalog groups (then variationIds and modifiers are ' +
  'ignored). Omitted (a client that predates the catalog): every default, and 400 OPTIONS_REQUIRED when that ' +
  'is not a valid choice. A choice that breaks a rule is 400 OPTIONS_INVALID with `errors`. The same product ' +
  'with the same picks and note goes on the existing line.';

const UPDATE_OPTIONS_DOC =
  'A new choice from the options catalog, checked and priced as on add (400 OPTIONS_INVALID); the line is not ' +
  'merged with another. Omitted (a quantity change): the line keeps its picks, re-priced against the menu as it ' +
  'is now; never reset or refused here, and one that can no longer be made leaves the cart at checkout.';

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

  @ApiPropertyOptional({ type: [OptionSelectionDto], description: ADD_OPTIONS_DOC })
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

  @ApiPropertyOptional({ type: [OptionSelectionDto], description: UPDATE_OPTIONS_DOC })
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
