import { ApiProperty } from '@nestjs/swagger';

/**
 * One 15-minute handover window at a store. Full slots are returned marked
 * unavailable rather than dropped, so checkout can show them greyed out —
 * "08:15 is booked" reads as a busy morning; a missing 08:15 reads as a bug.
 */
export class PickupSlotDto {
  @ApiProperty({ description: 'Slot start, ISO-8601 UTC' })
  startsAt!: string;

  @ApiProperty({ description: 'Slot end, ISO-8601 UTC' })
  endsAt!: string;

  @ApiProperty({ description: 'Handovers already promised in this slot' })
  taken!: number;

  /**
   * The store's «Заказов на 15 минут» capped a slot until 2026-11-06. Always
   * 0 since; still sent because the app builds in the stores require it.
   */
  @ApiProperty({
    deprecated: true,
    description:
      'Always 0: a slot is no longer capped by a number of orders (2026-11-06). Kept for app builds that ' +
      'require the field; read `available`.',
  })
  capacity!: number;

  @ApiProperty({
    description:
      'False once the slot is full: the kitchen work in it plus the cart work (when `cartId` was passed) would ' +
      'be more than 15 minutes of the kitchen, however many orders that is',
  })
  available!: boolean;
}
