import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AsapBlockedReason } from '@takeaway/shared-types';

import { OptionLineDto } from '../../option-groups/dto/option-groups.dto';

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

  @ApiProperty({
    type: [OptionLineDto],
    description:
      'Picks from the options catalog with names and prices, in page order (a product with catalog groups; then ' +
      'variationIds and modifiers are empty). Empty otherwise.',
  })
  options!: OptionLineDto[];

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

  @ApiPropertyOptional({
    description:
      'Queue policy only (QUEUE_POLICY_ENABLED), for a cart with lines: ISO UTC when the cart would be ready if ' +
      'ordered now (G, «Если закажете сейчас — будет готово в 12:11»). Absent with the flag off.',
  })
  readyAt?: string;

  @ApiPropertyOptional({ description: 'Queue policy only: whether the cart can be ordered for now.' })
  asapAvailable?: boolean;

  @ApiPropertyOptional({
    enum: ['OUTSIDE_HOURS', 'SHIFT_CLOSED', 'QUEUE_FULL', 'PAUSED', 'CLOSING_SOON'],
    nullable: true,
    description:
      'Queue policy only: why not, when `asapAvailable` is false — CLOSING_SOON when this cart would be ready ' +
      'after the closing («Не успеем до закрытия — выберите заказ ко времени»); null for a store switched off.',
  })
  asapBlockedReason?: AsapBlockedReason | null;
}

/** The queue policy's fields of a cart (all three or none). */
export type CartQueueFields = Required<Pick<CartDto, 'readyAt' | 'asapAvailable' | 'asapBlockedReason'>>;
