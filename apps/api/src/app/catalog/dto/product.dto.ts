import { ApiProperty } from '@nestjs/swagger';
import { CategoryKind, VariationType } from '@prisma/client';

import { ProductOptionGroupDto } from '../../option-groups/dto/option-groups.dto';

/** Calories and nutrition are a meal's: the storefronts get them for FOOD products only. */
const NUTRITION_NOTE = 'Null unless the kind of the product category is FOOD (meals only, since 2026-11-06)';

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

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Group the add-on is shown under («Сиропы», «Убрать»); null = the generic «Добавки» group',
  })
  group!: string | null;
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

  @ApiProperty({ nullable: true, type: Number, description: NUTRITION_NOTE })
  calories!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: NUTRITION_NOTE })
  proteinsGrams!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: NUTRITION_NOTE })
  fatsGrams!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: NUTRITION_NOTE })
  carbsGrams!: number | null;

  @ApiProperty({ type: [String] })
  imageUrls!: string[];

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({
    description: 'True when the product is currently hidden by stop-list on the requested store',
    required: false,
  })
  onStopList?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Catalog option groups ask for a look before it goes in the cart (a variant to pick, or the defaults are ' +
      'not a valid choice): a menu tile opens the product instead of adding it in one tap',
  })
  hasRequiredOptions?: boolean;

  @ApiProperty({
    enum: CategoryKind,
    description: "Kind of the product's category: picks the placeholder of a product without a photo",
  })
  categoryKind!: CategoryKind;
}

export class ProductDetailDto extends ProductDto {
  /**
   * The brand this product belongs to. A cart item is rejected when the
   * store it is added to belongs to a different brand, and a product opened
   * by its own URL carries no store, so the client needs this to pick one
   * that can actually make it.
   */
  @ApiProperty()
  brandId!: string;

  @ApiProperty({ type: [VariationDto] })
  variations!: VariationDto[];

  @ApiProperty({ type: [ModifierDto] })
  modifiers!: ModifierDto[];

  @ApiProperty({
    type: [ProductOptionGroupDto],
    description:
      'Groups from the options catalog, variants first, as this store has them. When non-empty the product is ' +
      'ordered through them alone and `variations` / `modifiers` are empty.',
  })
  optionGroups!: ProductOptionGroupDto[];
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

  @ApiProperty({ enum: CategoryKind, description: 'Hot drinks, cold drinks, food, bakery or other' })
  kind!: CategoryKind;

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
