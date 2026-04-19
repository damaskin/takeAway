import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BrandModerationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetBrandModerationDto {
  @ApiProperty({ enum: BrandModerationStatus })
  @IsEnum(BrandModerationStatus)
  status!: BrandModerationStatus;

  @ApiPropertyOptional({ description: 'Internal note shown on the brand record. Used for REJECTED reason.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
