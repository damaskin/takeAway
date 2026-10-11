import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryOptionKind, VariationType } from '@prisma/client';
import { MODIFIER_GROUP_MAX_LENGTH } from '@takeaway/shared-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { MAX_PRICE_CENTS } from './admin-product.dto';
import { trimGroup } from './option-group';

export class CategoryOptionInputDto {
  @ApiProperty({
    enum: CategoryOptionKind,
    description: 'VARIATION — a pick-one choice (`variationType`); MODIFIER — an add-on',
  })
  @IsEnum(CategoryOptionKind)
  kind!: CategoryOptionKind;

  @ApiPropertyOptional({ enum: VariationType, description: 'Required for VARIATION, ignored for MODIFIER' })
  @ValidateIf((o: CategoryOptionInputDto) => o.kind === CategoryOptionKind.VARIATION)
  @IsEnum(VariationType)
  variationType?: VariationType;

  @ApiPropertyOptional({ description: "Required unless `ingredientId` is given: then the add-on's name" })
  @ValidateIf((o: CategoryOptionInputDto) => o.name !== undefined || typeof o.ingredientId !== 'string')
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Add-on of the brand library. Omitted: an add-on (or a milk) joins the library entry of its name, created ' +
      'at `priceDeltaCents` and with `group` as its default group when missing; null = not tracked',
  })
  @IsOptional()
  @IsString()
  ingredientId?: string | null;

  @ApiPropertyOptional({ minimum: 0, description: "Omitted: the linked add-on's usual price, else 0" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  priceDeltaCents?: number;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: MODIFIER_GROUP_MAX_LENGTH,
    description: "MODIFIER only: the add-on group («Сиропы»). Omitted: the library entry's group; null = «Добавки»",
  })
  @IsOptional()
  @Transform(trimGroup)
  @IsString()
  @MaxLength(MODIFIER_GROUP_MAX_LENGTH)
  group?: string | null;

  @ApiPropertyOptional({ default: false, description: 'VARIATION only: pre-selected; one per type' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 99, description: 'MODIFIER only' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  maxCount?: number;
}

export class AddCategoryOptionsDto {
  @ApiProperty({
    type: [CategoryOptionInputDto],
    description:
      'Appended to the set in this order. An option the set already has (same add-on, or same name in the same ' +
      'group type) is skipped, so sending a preset twice adds nothing',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CategoryOptionInputDto)
  options!: CategoryOptionInputDto[];
}

export class UpdateCategoryOptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  priceDeltaCents?: number;

  @ApiPropertyOptional({ nullable: true, maxLength: MODIFIER_GROUP_MAX_LENGTH })
  @IsOptional()
  @Transform(trimGroup)
  @IsString()
  @MaxLength(MODIFIER_GROUP_MAX_LENGTH)
  group?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  maxCount?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** One option of a category's set, as the admin shows it. */
export interface CategoryOptionDto {
  id: string;
  categoryId: string;
  kind: CategoryOptionKind;
  variationType: VariationType | null;
  name: string;
  priceDeltaCents: number;
  group: string | null;
  isDefault: boolean;
  maxCount: number;
  sortOrder: number;
  ingredientId: string | null;
  ingredient: { id: string; name: string; isAvailable: boolean } | null;
}

/** What «apply to the category's products» did. */
export interface ApplyCategoryOptionsResultDto {
  /** Products in the category. */
  total: number;
  /** Products that got at least one option. */
  products: number;
  variations: number;
  modifiers: number;
}
