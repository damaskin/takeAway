import { ApiProperty } from '@nestjs/swagger';
import { BrandModerationStatus } from '@prisma/client';

/**
 * The launch checklist on an owner's dashboard, computed from what the
 * brand actually has — nothing here is ticked by hand.
 */
export class BrandOnboardingDto {
  @ApiProperty()
  brandId!: string;

  @ApiProperty({ enum: BrandModerationStatus })
  moderationStatus!: BrandModerationStatus;

  @ApiProperty({ type: String, nullable: true })
  moderationNote!: string | null;

  @ApiProperty({ description: 'A logo is uploaded (the name is set at sign-up).' })
  brandProfile!: boolean;

  @ApiProperty({ description: 'At least one store with an address and opening hours.' })
  store!: boolean;

  @ApiProperty({ description: 'At least one category and one product with a photo.' })
  menu!: boolean;

  @ApiProperty({ description: 'Card payments are switched on; otherwise customers pay on site.' })
  cardPayments!: boolean;

  @ApiProperty({ description: 'Every step is done and the brand is approved: the checklist can go.' })
  complete!: boolean;
}
