import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  brandId!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 60)
  slug!: string;

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

  @ApiPropertyOptional()
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
  @ApiProperty({ type: [String], description: 'Category ids in the desired order' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedIds!: string[];
}
