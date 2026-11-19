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

const LEGACY_DOC =
  'Ignored: the older per-product options were deleted on 2026-11-18. Still accepted from app builds that send it.';

const ADD_OPTIONS_DOC =
  'Picks from the options catalog. Omitted (a client that predates the catalog): every default, and 400 ' +
  'OPTIONS_REQUIRED when that is not a valid choice. A choice that breaks a rule is 400 OPTIONS_INVALID with ' +
  '`errors`. The same product with the same picks and note goes on the existing line. A product without a ' +
  'variant and an add-on is not sold (404, as on its page).';

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

  @ApiPropertyOptional({ type: [String], description: LEGACY_DOC, deprecated: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variationIds?: string[];

  @ApiPropertyOptional({ description: LEGACY_DOC, type: Object, deprecated: true })
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

  @ApiPropertyOptional({ type: [String], description: LEGACY_DOC, deprecated: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variationIds?: string[];

  @ApiPropertyOptional({ description: LEGACY_DOC, type: Object, deprecated: true })
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
