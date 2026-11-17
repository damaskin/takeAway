import { ApiProperty } from '@nestjs/swagger';
import { LoyaltyTier, PointsEntryType } from '@prisma/client';

/*
 * Points figures are integer units: a hundredth of a point, and a point is
 * worth one currency unit (1 балл = 1 руб.). 1240 reads «12,40 балла».
 */

export class LoyaltyEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PointsEntryType }) type!: PointsEntryType;
  @ApiProperty({ description: 'Signed, in units (a hundredth of a point).' }) amount!: number;
  @ApiProperty() reason!: string;
  @ApiProperty({ required: false, nullable: true }) orderId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class LoyaltyAccountDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ description: 'In units (a hundredth of a point).' }) pointsBalance!: number;
  @ApiProperty({ description: 'In units (a hundredth of a point).' }) lifetimePoints!: number;
  @ApiProperty({ enum: LoyaltyTier }) tier!: LoyaltyTier;
  /**
   * Next tier the user is progressing toward, or null if they are at SIGNATURE.
   */
  @ApiProperty({ enum: LoyaltyTier, required: false, nullable: true })
  nextTier!: LoyaltyTier | null;
  /** How many lifetime points are needed to enter nextTier (0 when none). */
  @ApiProperty({ description: 'In units (a hundredth of a point); 0 at the top tier.' }) pointsToNextTier!: number;
  /** 0..100 progress toward nextTier, for the UI progress bar. */
  @ApiProperty() tierProgressPercent!: number;
  @ApiProperty({ type: () => LoyaltyEntryDto, isArray: true }) recent!: LoyaltyEntryDto[];
}
