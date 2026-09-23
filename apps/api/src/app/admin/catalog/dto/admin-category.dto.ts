import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** What a slug may look like when someone does type one. */
export const SLUG_PATTERN = /^[a-z0-9-]+$/;
export const SLUG_MESSAGE = 'slug may contain only lowercase latin letters, digits and hyphens';

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  brandId!: string;

  @ApiPropertyOptional({
    description: 'Generated from the name (transliterated) when omitted; unique within the brand',
    pattern: SLUG_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiPropertyOptional({ description: 'Appended after the last category when omitted' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Minutes since local midnight' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  availableFrom?: number;

  @ApiPropertyOptional({ description: 'Minutes since local midnight' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  availableTo?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  visible?: boolean;
}

/** A category stays in its brand: `brandId` is not updatable. */
export class UpdateCategoryDto extends PartialType(OmitType(CreateCategoryDto, ['brandId'] as const)) {}

export class ReorderCategoriesDto {
  @ApiProperty({ type: [String], description: 'Category ids of one brand in the desired order' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class DeleteCategoryQueryDto {
  @ApiPropertyOptional({
    description: 'Category of the same brand that receives the products before the delete',
  })
  @IsOptional()
  @IsString()
  moveProductsTo?: string;
}
