import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BrandModerationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class SetBrandModerationDto {
  @ApiProperty({ enum: BrandModerationStatus })
  @IsEnum(BrandModerationStatus)
  status!: BrandModerationStatus;

  /**
   * Mailed to the owner with a rejection, so it is required then: "rejected"
   * with no reason leaves them nothing to fix. Optional otherwise.
   */
  @ApiPropertyOptional({ description: 'Reason shown to the owner. Required when status is REJECTED.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o: SetBrandModerationDto) => o.status === BrandModerationStatus.REJECTED || !isBlank(o.note))
  @IsString()
  @IsNotEmpty({ message: 'note is required when rejecting a brand' })
  @MaxLength(1000)
  note?: string;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
