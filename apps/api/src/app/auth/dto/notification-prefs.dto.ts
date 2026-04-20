import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class NotificationPrefsDto {
  @ApiProperty()
  notifyOrderUpdates!: boolean;

  @ApiProperty()
  notifyPromotions!: boolean;
}

export class UpdateNotificationPrefsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  notifyOrderUpdates?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  notifyPromotions?: boolean;
}
