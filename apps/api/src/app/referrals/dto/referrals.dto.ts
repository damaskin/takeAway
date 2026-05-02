import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReferralSummaryDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  signupsCount!: number;

  @ApiProperty()
  rewardedCount!: number;

  @ApiProperty()
  pointsEarned!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  appliedCode!: string | null;
}

export class ApplyReferralDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;
}
