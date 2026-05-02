import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const CHANNELS = ['PUSH', 'TELEGRAM', 'EMAIL'] as const;
const AUDIENCES = ['ALL', 'HAS_ORDERED', 'INACTIVE_30D'] as const;
const STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED'] as const;

export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(2000)
  body!: string;

  @ApiProperty({ enum: CHANNELS })
  @IsEnum(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @ApiPropertyOptional({ enum: AUDIENCES, default: 'ALL' })
  @IsOptional()
  @IsEnum(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];
}

export class CampaignDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  brandId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ enum: CHANNELS })
  channel!: (typeof CHANNELS)[number];

  @ApiProperty({ enum: AUDIENCES })
  audience!: (typeof AUDIENCES)[number];

  @ApiProperty({ enum: STATUSES })
  status!: (typeof STATUSES)[number];

  @ApiProperty()
  targetCount!: number;

  @ApiProperty()
  sentCount!: number;

  @ApiProperty()
  failedCount!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  sentAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}
