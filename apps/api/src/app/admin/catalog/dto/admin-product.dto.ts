import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
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
// 10 000 000 in currency units: room for rupiah prices, still far below the column's limit.
export const MAX_PRICE_CENTS = 1_000_000_000;
const MAX_PREP_SECONDS = 24 * 60 * 60;

/**
 * Caffeine, allergens and diet tags are gone from the menu since 2026-11-05:
 * the global ValidationPipe (`forbidNonWhitelisted`) refuses a request that
 * still sends `caffeineLevel`, `allergens` or `dietTags` — the admin is the
 * only writer, and a stale admin tab gets a clear 400 until it reloads.
 */
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

  @ApiPropertyOptional({
    default: false,
    description:
      '«Готовится параллельно» (queue policy): the product takes no station and is made alongside the rest of the ' +
      'order — a bottled drink, a pastry warmed in an oven of its own.',
  })
  @IsOptional()
  @IsBoolean()
  prepParallel?: boolean;

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

  @ApiPropertyOptional({
    type: [String],
    description:
      'Stores of the brand that sell the product (same price everywhere). On create, omitted = every store of the ' +
      'brand; on update, omitted = unchanged, a list replaces the listing. Empty = sold nowhere.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  storeIds?: string[];

  @ApiPropertyOptional({
    default: true,
    description:
      "Create only: when `prepTimeSeconds` is omitted, start at the category's default preparation time. " +
      'False = the form default. (It also copied the category option set, deleted on 2026-11-18.)',
  })
  @IsOptional()
  @IsBoolean()
  applyCategoryOptions?: boolean;
}

/** A product stays in its brand: `brandId` is not updatable. The category's default applies on create only. */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['brandId', 'applyCategoryOptions'] as const),
) {}

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
