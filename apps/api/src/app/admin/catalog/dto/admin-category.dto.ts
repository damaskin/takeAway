import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { CategoryKind } from '@prisma/client';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
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

  @ApiPropertyOptional({
    default: false,
    description:
      'Not sold on its own: the category and its products are left out of customer menus and refused by the cart ' +
      '(e.g. a POS import of extra ingredients). A POS sync never changes it',
  })
  @IsOptional()
  @IsBoolean()
  addOnsOnly?: boolean;

  @ApiPropertyOptional({
    enum: CategoryKind,
    default: CategoryKind.OTHER,
    description:
      'What the category holds: decides the product fields the admin shows, the option presets it offers and the ' +
      'placeholder of a product without a photo. A POS sync never changes it',
  })
  @IsOptional()
  @IsEnum(CategoryKind)
  kind?: CategoryKind;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 24 * 60 * 60,
    description:
      'Preparation time a new product of the category starts with, seconds; null = none. A POS sync never changes it',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  defaultPrepTimeSeconds?: number | null;
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
