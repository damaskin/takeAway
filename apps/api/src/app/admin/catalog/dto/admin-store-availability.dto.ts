import { ApiProperty } from '@nestjs/swagger';

/** A store-local stop that still holds; `expiresAt` null = until switched back on. */
export class AvailabilityStopDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
}

export class AvailabilityProductDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  categoryId!: string;

  @ApiProperty()
  categoryName!: string;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ type: AvailabilityStopDto, nullable: true, description: 'Null = on sale in this store' })
  stop!: AvailabilityStopDto | null;
}

/** A catalog option some product of the store offers (docs/option-groups.md). */
export class AvailabilityOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty()
  groupId!: string;

  @ApiProperty()
  groupName!: string;

  @ApiProperty({
    type: AvailabilityStopDto,
    nullable: true,
    description: 'Null = not stopped in this store (PUT/DELETE /admin/stores/:id/option-stops/:optionId)',
  })
  stop!: AvailabilityStopDto | null;

  @ApiProperty({ type: [String], description: 'Products of this store with its group attached' })
  productNames!: string[];
}

/** What a store sells right now: the stop-list screen of the admin. */
export class StoreAvailabilityDto {
  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  storeName!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ type: [AvailabilityProductDto] })
  products!: AvailabilityProductDto[];

  @ApiProperty({
    type: [AvailabilityOptionDto],
    description: "Options catalog: the options of the store's products' groups the brand offers, in catalog order",
  })
  options!: AvailabilityOptionDto[];
}
