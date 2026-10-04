import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import type { StoreRejectReason } from '../../notifications/notifications.service';

export const STORE_REJECT_REASONS: readonly StoreRejectReason[] = ['OUT_OF_STOCK', 'TOO_BUSY', 'CLOSING', 'OTHER'];

export class RejectOrderDto {
  @ApiProperty({ enum: STORE_REJECT_REASONS, description: 'Why the store turns the order down' })
  @IsIn(STORE_REJECT_REASONS)
  reason!: StoreRejectReason;

  @ApiPropertyOptional({ description: 'Shown to the customer as is', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;
}
