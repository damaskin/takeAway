import { ApiProperty } from '@nestjs/swagger';
import { Currency, FulfillmentType, OrderStatus, PickupMode, VariationType } from '@prisma/client';
import type { OrderItemModifier, OrderItemSnapshot, OrderItemVariation } from '@takeaway/shared-types';

export class OrderItemVariationDto implements OrderItemVariation {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: VariationType })
  type!: VariationType;

  @ApiProperty({ example: 'L' })
  name!: string;

  @ApiProperty({ description: 'What this variation added to the unit price, in cents.' })
  priceDeltaCents!: number;
}

export class OrderItemModifierDto implements OrderItemModifier {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Vanilla syrup' })
  name!: string;

  @ApiProperty({ minimum: 1 })
  count!: number;

  @ApiProperty({ description: 'Price of one, in cents; the line pays count × priceCents.' })
  priceCents!: number;
}

/**
 * The line exactly as it was bought, frozen at order creation. Every field
 * is always present in responses.
 *
 * `variations` and `modifierLines` are what the kitchen, the receipt and the
 * order screens show. They are empty on orders placed before options were
 * snapshotted, which carry only the ids; `variationIds` and `modifiers` are
 * kept as they always were.
 */
export class OrderItemSnapshotDto implements OrderItemSnapshot {
  @ApiProperty({ description: 'Product id.' })
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ description: 'Product name at order time.' })
  name!: string;

  @ApiProperty({ type: [String] })
  variationIds!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Map { modifierId: count } — the form the POS push reads.',
  })
  modifiers!: Record<string, number>;

  @ApiProperty({ nullable: true, type: String, description: "The customer's note for this line." })
  notes!: string | null;

  @ApiProperty()
  unitPrepSeconds!: number;

  @ApiProperty({
    type: [OrderItemVariationDto],
    description: 'Chosen (or defaulted) variations, size first, then milk, temperature, cup.',
  })
  variations!: OrderItemVariationDto[];

  @ApiProperty({ type: [OrderItemModifierDto], description: 'Extras with a positive count, in menu order.' })
  modifierLines!: OrderItemModifierDto[];
}

export class OrderItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: OrderItemSnapshotDto })
  productSnapshot!: OrderItemSnapshotDto;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPriceCents!: number;

  @ApiProperty()
  totalCents!: number;
}

/**
 * What the customer needs to know about the money, in their own terms.
 *
 * `HELD` is the state that matters for the hold-until-accepted flow: the card
 * was authorized at checkout but nothing has been taken yet, and it will be
 * taken when the store accepts the order.
 */
export type OrderPaymentState = 'NONE' | 'PENDING' | 'HELD' | 'PAID' | 'FAILED' | 'REFUNDED';

export class OrderPaymentDto {
  @ApiProperty({
    enum: ['NONE', 'PENDING', 'HELD', 'PAID', 'FAILED', 'REFUNDED'],
    description: 'NONE when the order carries no card payment at all (paid at the counter).',
  })
  state!: OrderPaymentState;

  @ApiProperty({ description: 'Authorized or captured amount, in minor units. 0 when there is no payment.' })
  amountCents!: number;

  @ApiProperty({ nullable: true, type: String, description: 'Card the payment went to, masked.' })
  cardMask!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'When the money was captured.' })
  paidAt!: string | null;
}

export class OrderDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderCode!: string;

  @ApiProperty()
  qrToken!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ enum: PickupMode })
  pickupMode!: PickupMode;

  @ApiProperty({ enum: FulfillmentType })
  fulfillmentType!: FulfillmentType;

  @ApiProperty()
  pickupAt!: string;

  @ApiProperty()
  subtotalCents!: number;

  @ApiProperty()
  discountCents!: number;

  @ApiProperty()
  taxCents!: number;

  @ApiProperty()
  totalCents!: number;

  @ApiProperty({ enum: Currency })
  currency!: Currency;

  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  storeName!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "IANA zone of the store — pickup times are shown on the store's clock.",
  })
  storeTimezone!: string | null;

  @ApiProperty({ description: 'Store location — used to render the pickup map.' })
  storeLatitude!: number;

  @ApiProperty()
  storeLongitude!: number;

  @ApiProperty({ nullable: true, type: String })
  storeAddress!: string | null;

  @ApiProperty({ nullable: true, type: String })
  customerName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  customerPhone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ nullable: true, type: String })
  couponCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  giftCardCode!: string | null;

  @ApiProperty()
  giftCardCents!: number;

  @ApiProperty({ type: [OrderItemDto] })
  items!: OrderItemDto[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String })
  acceptedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  startedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  readyAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  pickedUpAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  expiredAt!: string | null;

  // ── Delivery fields (null for PICKUP / DINE_IN orders) ──────────────────

  @ApiProperty({ nullable: true, type: String })
  deliveryAddressLine!: string | null;

  @ApiProperty({ nullable: true, type: String })
  deliveryCity!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  deliveryLatitude!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  deliveryLongitude!: number | null;

  @ApiProperty({ nullable: true, type: String })
  deliveryNotes!: string | null;

  @ApiProperty({ description: '0 for PICKUP / DINE_IN orders.' })
  deliveryFeeCents!: number;

  @ApiProperty({ nullable: true, type: Number, description: 'Distance store→customer in metres, when geocoded.' })
  deliveryDistanceM!: number | null;

  @ApiProperty({ nullable: true, type: String, description: 'Assigned rider user id.' })
  riderId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  outForDeliveryAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  deliveredAt!: string | null;

  @ApiProperty({ type: OrderPaymentDto })
  payment!: OrderPaymentDto;
}

export class OrderSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderCode!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ enum: PickupMode })
  pickupMode!: PickupMode;

  @ApiProperty()
  pickupAt!: string;

  @ApiProperty()
  totalCents!: number;

  @ApiProperty({ enum: Currency })
  currency!: Currency;

  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  storeName!: string;

  @ApiProperty({ description: "IANA zone of the store — pickup times are shown on the store's clock." })
  storeTimezone!: string;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  createdAt!: string;
}
