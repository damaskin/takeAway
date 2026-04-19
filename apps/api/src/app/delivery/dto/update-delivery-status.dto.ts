import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * Rider-driven status transitions for delivery orders. Only two states
 * are reachable this way — READY → OUT_FOR_DELIVERY (rider has collected
 * the bag from the store) and OUT_FOR_DELIVERY → DELIVERED (rider handed
 * it to the customer). CANCELLED on a dispatched order is a manager-only
 * path and lives on a separate endpoint.
 */
export type DeliveryTransition = 'OUT_FOR_DELIVERY' | 'DELIVERED';

export class UpdateDeliveryStatusDto {
  @ApiProperty({ enum: ['OUT_FOR_DELIVERY', 'DELIVERED'] })
  @IsIn(['OUT_FOR_DELIVERY', 'DELIVERED'])
  to!: DeliveryTransition;
}
