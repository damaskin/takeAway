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

  @ApiProperty({ description: "The store's ceiling for one slot" })
  capacity!: number;

  @ApiProperty({ description: 'False once the slot is at capacity' })
  available!: boolean;
}
