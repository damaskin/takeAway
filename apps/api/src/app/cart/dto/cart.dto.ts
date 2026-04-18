import { ApiProperty } from '@nestjs/swagger';

export class CartItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ type: [String] })
  variationIds!: string[];

  @ApiProperty({ type: Object, description: 'Map { modifierId: count }' })
  modifiers!: Record<string, number>;

  @ApiProperty()
  unitPriceCents!: number;

  @ApiProperty()
  unitPrepSeconds!: number;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;
}

export class CartDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  subtotalCents!: number;

  @ApiProperty({ description: 'Estimated ready-by ETA in seconds for ASAP pickup' })
  etaSeconds!: number;

  @ApiProperty({ type: [CartItemDto] })
  items!: CartItemDto[];

  @ApiProperty()
  updatedAt!: string;
}
