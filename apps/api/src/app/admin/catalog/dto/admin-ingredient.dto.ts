import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { MAX_PRICE_CENTS } from './admin-product.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateIngredientDto {
  @ApiProperty()
  @IsString()
  brandId!: string;

  @ApiProperty({ example: 'Oat milk', description: 'Unique within the brand' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    description:
      'Usual surcharge in minor units. An option put on a product from the library starts at it; ' +
      'changing it moves every option that still charges the old price',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  priceCents?: number;

  @ApiPropertyOptional({ default: true, description: 'False hides every option made of it from customers' })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

/** A rename also renames the options that still carry the old name. */
export class UpdateIngredientDto extends PartialType(OmitType(CreateIngredientDto, ['brandId'] as const)) {}

/** A library entry with what it is used in, for the admin's list. */
export interface IngredientAdminDto {
  id: string;
  brandId: string;
  name: string;
  priceCents: number;
  isAvailable: boolean;
  /** Products offering it (through an extra or a milk), by name. */
  products: Array<{ id: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
}
