import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

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

  @ApiPropertyOptional({ default: true, description: 'False hides every option made of it from customers' })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class UpdateIngredientDto extends PartialType(OmitType(CreateIngredientDto, ['brandId'] as const)) {}

/** A library entry with what it is used in, for the admin's list. */
export interface IngredientAdminDto {
  id: string;
  brandId: string;
  name: string;
  isAvailable: boolean;
  /** Products with at least one option made of it, by name. */
  products: Array<{ id: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
}
