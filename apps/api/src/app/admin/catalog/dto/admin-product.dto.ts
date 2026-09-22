import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { DietTag, VariationType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { SLUG_MESSAGE, SLUG_PATTERN } from './admin-category.dto';

/** Photos per product: enough for a gallery, few enough to keep a menu card light. */
export const MAX_PRODUCT_IMAGES = 6;

/**
 * Upper bounds keep a typo (an extra zero or three) from reaching an `Int`
 * column that overflows at 2^31 — a 500 instead of a clear 400.
 */
const MAX_PRICE_CENTS = 100_000_000;
const MAX_PREP_SECONDS = 24 * 60 * 60;

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  brandId!: string;

  @ApiProperty()
  @IsString()
  categoryId!: string;

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
  @Length(1, 160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ minimum: 0, maximum: MAX_PRICE_CENTS })
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  basePriceCents!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_PREP_SECONDS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PREP_SECONDS)
  prepTimeSeconds?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 4 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  caffeineLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  calories?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  proteinsGrams?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  fatsGrams?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  carbsGrams?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  allergens?: string[];

  @ApiPropertyOptional({ enum: DietTag, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(DietTag, { each: true })
  dietTags?: DietTag[];

  @ApiPropertyOptional({ type: [String], maxItems: MAX_PRODUCT_IMAGES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @ApiPropertyOptional({ description: 'Appended after the last product of the category when omitted' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** A product stays in its brand: `brandId` is not updatable. */
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['brandId'] as const)) {}

export class ToggleVisibilityDto {
  @ApiProperty()
  @IsBoolean()
  visible!: boolean;
}

export class ReorderProductsDto {
  @ApiProperty({ type: [String], description: 'Product ids of one category in the desired order' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class ProductImageQueryDto {
  @ApiProperty({ description: "One of the product's image URLs" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url!: string;
}

export class ReorderProductImagesDto {
  @ApiProperty({
    type: [String],
    description:
      'Image URLs already on the product, in the new order. The first one is the photo customers see in the menu; ' +
      'images left out keep their order after the listed ones.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @ArrayUnique()
  @IsString({ each: true })
  urls!: string[];
}

export class CreateVariationDto {
  @ApiProperty({ enum: VariationType })
  @IsEnum(VariationType)
  type!: VariationType;

  @ApiProperty()
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-MAX_PRICE_CENTS)
  @Max(MAX_PRICE_CENTS)
  priceDeltaCents?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-MAX_PREP_SECONDS)
  @Max(MAX_PREP_SECONDS)
  prepTimeDeltaSeconds?: number;

  @ApiPropertyOptional({ description: 'Appended after the last variation of the same type when omitted' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: false, description: 'At most one default per type; setting one clears the rest' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateVariationDto extends PartialType(CreateVariationDto) {}

export class CreateModifierDto {
  @ApiPropertyOptional({
    description: 'Generated from the name (transliterated) when omitted; unique within the product',
    pattern: SLUG_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-MAX_PRICE_CENTS)
  @Max(MAX_PRICE_CENTS)
  priceDeltaCents?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-MAX_PREP_SECONDS)
  @Max(MAX_PREP_SECONDS)
  prepTimeDeltaSeconds?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  minCount?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  maxCount?: number;

  @ApiPropertyOptional({ description: 'Appended after the last modifier when omitted' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateModifierDto extends PartialType(CreateModifierDto) {}
