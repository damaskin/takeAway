import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminOrderEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) actorId!: string | null;
  @ApiPropertyOptional({ nullable: true }) payload!: unknown;
}

export class AdminOrderPaymentDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() status!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() refundedCents!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) providerRef!: string | null;
  @ApiProperty() createdAt!: string;
}

export class AdminOrderItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPriceCents!: number;
  @ApiProperty() totalCents!: number;
}

/**
 * Everything a manager needs to answer "what happened to this order?" on
 * one screen: what was ordered, what was charged, what was refunded, and
 * the full timeline of who moved it where.
 *
 * The list view alone could not answer a customer asking for their money
 * back, which is why the refund endpoint existed with no way to reach it.
 */
export class AdminOrderDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderCode!: string;
  @ApiProperty() status!: string;
  @ApiProperty() fulfillmentType!: string;
  @ApiProperty() pickupMode!: string;
  @ApiProperty() pickupAt!: string;
  @ApiProperty() createdAt!: string;

  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;

  @ApiPropertyOptional({ type: String, nullable: true }) customerName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) customerPhone!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) customerEmail!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes!: string | null;

  @ApiProperty() currency!: string;
  @ApiProperty() subtotalCents!: number;
  @ApiProperty() discountCents!: number;
  @ApiProperty() taxCents!: number;
  @ApiProperty() deliveryFeeCents!: number;
  @ApiProperty() giftCardCents!: number;
  @ApiProperty() totalCents!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) couponCode!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) giftCardCode!: string | null;

  @ApiProperty({ description: 'Already refunded across all payments, in cents.' })
  refundedCents!: number;
  @ApiProperty({ description: 'What can still be refunded, in cents. 0 hides the refund control.' })
  refundableCents!: number;

  @ApiProperty({ type: [AdminOrderItemDto] }) items!: AdminOrderItemDto[];
  @ApiProperty({ type: [AdminOrderPaymentDto] }) payments!: AdminOrderPaymentDto[];
  @ApiProperty({ type: [AdminOrderEventDto] }) events!: AdminOrderEventDto[];
}
