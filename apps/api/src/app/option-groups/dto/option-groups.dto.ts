import { ApiProperty } from '@nestjs/swagger';
import { OptionGroupKind, OptionGroupType } from '@prisma/client';
import type { OptionLine, OptionSelection, ProductOptionGroup, ProductOptionItem } from '@takeaway/shared-types';
import { IsNumber, IsString, MaxLength } from 'class-validator';

/** One option of a catalog group as a store's customers see it. */
export class ProductOptionItemDto implements ProductOptionItem {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Second line under the name («300–350 мл»)' })
  note!: string | null;

  @ApiProperty({ description: 'A and B: picked when the product page opens (the product may override the catalog)' })
  isDefault!: boolean;

  @ApiProperty({ type: Number, nullable: true, description: 'C only: the lowest count' })
  minQty!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'C only: the highest count' })
  maxQty!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'C only: the starting count, included in the base price' })
  defaultQty!: number | null;

  @ApiProperty({
    description:
      "Store currency, minor units. VARIANT: added to the product's base price (per product, may be < 0); " +
      'ADDON A/B: its price (per brand); ADDON C: the price of one unit above defaultQty.',
  })
  priceCents!: number;

  @ApiProperty({ description: 'False while the store has run out of it: shown greyed out, cannot be picked' })
  available!: boolean;

  @ApiProperty()
  sortOrder!: number;
}

/** One catalog group attached to a product, as a store's customers see it. */
export class ProductOptionGroupDto implements ProductOptionGroup {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: OptionGroupKind })
  kind!: OptionGroupKind;

  @ApiProperty({ enum: ['A', 'B', 'C'], description: 'A list, B yes/no on every option, C a counter on every option' })
  type!: OptionGroupType;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: Number, nullable: true, description: 'A only: fewest picks (a VARIANT group asks for 1)' })
  minSelect!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'A only: most picks; null = as many as there are' })
  maxSelect!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Shown only while this option is picked, when that option's group is on the product; always shown otherwise",
  })
  showIfOptionId!: string | null;

  @ApiProperty({ type: [ProductOptionItemDto], description: 'In catalog order; never empty' })
  options!: ProductOptionItemDto[];
}

/** One pick sent to the cart: an option and how many (1 for A and B). */
export class OptionSelectionDto implements OptionSelection {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  optionId!: string;

  /** Checked by the option rules, which answer `BAD_QTY` (not a validation 400) for a bad count. */
  @ApiProperty({ description: '1 for A and B; the count for C. 0 = not picked.' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  qty!: number;
}

/** One picked option in a cart line or an order snapshot, with its names and price as picked. */
export class OptionLineDto implements OptionLine {
  @ApiProperty()
  groupId!: string;

  @ApiProperty()
  groupName!: string;

  @ApiProperty({ enum: OptionGroupKind })
  kind!: OptionGroupKind;

  @ApiProperty({ enum: OptionGroupType })
  type!: OptionGroupType;

  @ApiProperty()
  optionId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  qty!: number;

  @ApiProperty({ description: 'See ProductOptionItem.priceCents' })
  unitPriceCents!: number;

  @ApiProperty({ description: 'C only: the units included in the price; 0 for A and B' })
  freeQty!: number;

  @ApiProperty({ description: 'What it adds to one item' })
  totalCents!: number;
}
