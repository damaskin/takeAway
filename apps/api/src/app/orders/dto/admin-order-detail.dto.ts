import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderCancelMoney, OrderCancelReason, OrderCanceller } from '@prisma/client';

import { OptionLineDto } from '../../option-groups/dto/option-groups.dto';
import { TakeawayPromoLineDto } from '../../takeaway-promos/dto/takeaway-promo.dto';
import { OrderItemModifierDto, OrderItemVariationDto } from './order.dto';

export class AdminOrderEventDto {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) actorId!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Event details as recorded, minus customer coordinates (arrival events keep `distanceM`)',
  })
  payload!: unknown;
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
  /** Empty on orders placed before options were snapshotted. */
  @ApiProperty({ type: [OrderItemVariationDto] }) variations!: OrderItemVariationDto[];
  @ApiProperty({ type: [OrderItemModifierDto] }) modifierLines!: OrderItemModifierDto[];
  /** Picks from the options catalog, variants first; empty for products without catalog groups. */
  @ApiProperty({ type: [OptionLineDto] }) optionLines!: OptionLineDto[];
  @ApiPropertyOptional({ type: String, nullable: true }) notes!: string | null;
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
  /** IANA zone of the store — times on the order are shown on the store's clock. */
  @ApiPropertyOptional({ type: String, nullable: true }) storeTimezone!: string | null;

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
  /**
   * «Акция takeAway −10%: гость оплатил 90,00, ещё 10,00 компенсирует
   * takeAway» — the order is paid in full, nothing to collect from the guest.
   */
  @ApiPropertyOptional({ type: () => TakeawayPromoLineDto, nullable: true })
  takeawayPromo!: TakeawayPromoLineDto | null;

  @ApiPropertyOptional({ type: String, nullable: true }) cancelledAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) expiredAt!: string | null;
  @ApiPropertyOptional({ enum: OrderCanceller, nullable: true, description: 'See OrderDto.cancelledBy.' })
  cancelledBy!: OrderCanceller | null;
  @ApiPropertyOptional({ enum: OrderCancelReason, nullable: true, description: 'See OrderDto.cancelReason.' })
  cancelReason!: OrderCancelReason | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "The kitchen's comment when it turned the order down, as the customer saw it.",
  })
  cancelComment!: string | null;
  @ApiPropertyOptional({
    enum: OrderCancelMoney,
    nullable: true,
    description:
      "See OrderDto.cancelMoney. The bank's message on a declined card is on the CANCELLED event (`bankMessage`).",
  })
  cancelMoney!: OrderCancelMoney | null;

  @ApiProperty({ description: 'Already refunded across all payments, in cents.' })
  refundedCents!: number;
  @ApiProperty({ description: 'What can still be refunded, in cents. 0 hides the refund control.' })
  refundableCents!: number;

  @ApiProperty({ type: [AdminOrderItemDto] }) items!: AdminOrderItemDto[];
  @ApiProperty({ type: [AdminOrderPaymentDto] }) payments!: AdminOrderPaymentDto[];
  @ApiProperty({ type: [AdminOrderEventDto] }) events!: AdminOrderEventDto[];
}
