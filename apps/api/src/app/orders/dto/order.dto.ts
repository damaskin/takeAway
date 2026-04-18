import { ApiProperty } from '@nestjs/swagger';
import { Currency, FulfillmentType, OrderStatus, PickupMode } from '@prisma/client';

export class OrderItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Object })
  productSnapshot!: Record<string, unknown>;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPriceCents!: number;

  @ApiProperty()
  totalCents!: number;
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

  @ApiProperty({ nullable: true, type: String })
  customerName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  customerPhone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes!: string | null;

  @ApiProperty({ nullable: true, type: String })
  couponCode!: string | null;

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

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  createdAt!: string;
}
