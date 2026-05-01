import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PosIntegrationStatus, PosProvider, PosSyncJobKind, PosSyncJobStatus } from '@prisma/client';

export class PosSyncJobDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: PosSyncJobKind })
  kind!: PosSyncJobKind;

  @ApiProperty({ enum: PosSyncJobStatus })
  status!: PosSyncJobStatus;

  @ApiProperty()
  progress!: number;

  @ApiProperty()
  total!: number;

  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  startedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  finishedAt!: string | null;
}

export class PosIntegrationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  brandId!: string;

  @ApiProperty({ enum: PosProvider })
  provider!: PosProvider;

  @ApiProperty({ enum: PosIntegrationStatus })
  status!: PosIntegrationStatus;

  @ApiProperty({ type: Object })
  settings!: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastErrorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: PosSyncJobDto, nullable: true })
  lastJob!: PosSyncJobDto | null;
}
