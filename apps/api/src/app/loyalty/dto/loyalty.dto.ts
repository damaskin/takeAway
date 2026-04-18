import { ApiProperty } from '@nestjs/swagger';
import { LoyaltyTier, PointsEntryType } from '@prisma/client';

export class LoyaltyEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PointsEntryType }) type!: PointsEntryType;
  @ApiProperty() amount!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({ required: false, nullable: true }) orderId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class LoyaltyAccountDto {
  @ApiProperty() userId!: string;
  @ApiProperty() pointsBalance!: number;
  @ApiProperty() lifetimePoints!: number;
  @ApiProperty({ enum: LoyaltyTier }) tier!: LoyaltyTier;
  /**
   * Next tier the user is progressing toward, or null if they are at SIGNATURE.
   */
  @ApiProperty({ enum: LoyaltyTier, required: false, nullable: true })
  nextTier!: LoyaltyTier | null;
  /** How many lifetime points are needed to enter nextTier (0 when none). */
  @ApiProperty() pointsToNextTier!: number;
  /** 0..100 progress toward nextTier, for the UI progress bar. */
  @ApiProperty() tierProgressPercent!: number;
  @ApiProperty({ type: () => LoyaltyEntryDto, isArray: true }) recent!: LoyaltyEntryDto[];
}
