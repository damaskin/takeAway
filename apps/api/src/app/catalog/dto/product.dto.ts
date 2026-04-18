import { ApiProperty } from '@nestjs/swagger';
import { DietTag, VariationType } from '@prisma/client';

export class VariationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: VariationType })
  type!: VariationType;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  priceDeltaCents!: number;

  @ApiProperty()
  prepTimeDeltaSeconds!: number;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isDefault!: boolean;
}

export class ModifierDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  priceDeltaCents!: number;

  @ApiProperty()
  prepTimeDeltaSeconds!: number;

  @ApiProperty()
  minCount!: number;

  @ApiProperty()
  maxCount!: number;

  @ApiProperty()
  sortOrder!: number;
}

export class ProductDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  categoryId!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty()
  basePriceCents!: number;

  @ApiProperty()
  prepTimeSeconds!: number;

  @ApiProperty({ nullable: true, type: Number })
  caffeineLevel!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  calories!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  proteinsGrams!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  fatsGrams!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  carbsGrams!: number | null;

  @ApiProperty({ type: [String] })
  allergens!: string[];

  @ApiProperty({ enum: DietTag, isArray: true })
  dietTags!: DietTag[];

  @ApiProperty({ type: [String] })
  imageUrls!: string[];

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({
    description: 'True when the product is currently hidden by stop-list on the requested store',
    required: false,
  })
  onStopList?: boolean;
}

export class ProductDetailDto extends ProductDto {
  @ApiProperty({ type: [VariationDto] })
  variations!: VariationDto[];

  @ApiProperty({ type: [ModifierDto] })
  modifiers!: ModifierDto[];
}

export class CategoryWithProductsDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ nullable: true, type: String })
  iconUrl!: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ nullable: true, type: Number })
  availableFrom!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  availableTo!: number | null;

  @ApiProperty({ type: [ProductDto] })
  products!: ProductDto[];
}

export class MenuDto {
  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  storeSlug!: string;

  @ApiProperty({ type: [CategoryWithProductsDto] })
  categories!: CategoryWithProductsDto[];
}
