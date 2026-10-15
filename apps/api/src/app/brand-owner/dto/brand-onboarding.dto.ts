import { ApiProperty } from '@nestjs/swagger';
import { BrandModerationStatus } from '@prisma/client';

/**
 * The launch checklist on an owner's dashboard, computed from what the
 * brand actually has — nothing here is ticked by hand. Required: `store`,
 * `menu`, payments and the approval; `brandProfile` and `photos` are
 * recommendations that do not hold the launch back.
 */
export class BrandOnboardingDto {
  @ApiProperty()
  brandId!: string;

  @ApiProperty({ enum: BrandModerationStatus })
  moderationStatus!: BrandModerationStatus;

  @ApiProperty({ type: String, nullable: true })
  moderationNote!: string | null;

  @ApiProperty({ description: 'Recommended, not required: a logo is uploaded (the name is set at sign-up).' })
  brandProfile!: boolean;

  @ApiProperty({ description: 'At least one store with an address and opening hours.' })
  store!: boolean;

  @ApiProperty({
    description: 'At least one product customers can see: visible, in a visible category that is not add-ons only.',
  })
  menu!: boolean;

  @ApiProperty({ description: 'Recommended, not required: at least one product has a photo.' })
  photos!: boolean;

  @ApiProperty({ description: 'Card payments are switched on; otherwise customers pay on site.' })
  cardPayments!: boolean;

  @ApiProperty({ description: 'The brand has an order that was not cancelled or expired.' })
  hasOrders!: boolean;

  @ApiProperty({
    description: 'Launched: every required step is done and the brand is approved, or it has sold already.',
  })
  complete!: boolean;
}
