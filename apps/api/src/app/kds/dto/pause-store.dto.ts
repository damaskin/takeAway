import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StorePauseReason } from '@prisma/client';
import {
  KITCHEN_PAUSE_COMMENT_MAX,
  KITCHEN_PAUSE_MINUTES,
  type KitchenPauseMinutes,
  type KitchenPauseRequest,
} from '@takeaway/shared-types';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** `PUT /kds/pause` — the kitchen's «Пауза». */
export class PauseStoreDto implements KitchenPauseRequest {
  @ApiProperty({
    enum: [...KITCHEN_PAUSE_MINUTES],
    nullable: true,
    type: Number,
    description: 'How long; null = until the closing (the end of the working hours or of the extension)',
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn([...KITCHEN_PAUSE_MINUTES])
  minutes!: KitchenPauseMinutes | null;

  @ApiProperty({ enum: StorePauseReason, description: 'Why; staff and the owner see it, customers do not' })
  @IsEnum(StorePauseReason)
  reason!: StorePauseReason;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: KITCHEN_PAUSE_COMMENT_MAX,
    description: 'For the owner and staff, e.g. «кофемашина»',
  })
  @IsOptional()
  @IsString()
  @MaxLength(KITCHEN_PAUSE_COMMENT_MAX)
  comment?: string | null;
}
