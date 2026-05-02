import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class WebPushKeysDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  auth!: string;
}

export class RegisterDeviceDto {
  @ApiProperty({ enum: ['IOS', 'ANDROID', 'WEB'] })
  @IsEnum(['IOS', 'ANDROID', 'WEB'])
  type!: 'IOS' | 'ANDROID' | 'WEB';

  /**
   * Native push tokens (APNs / FCM) come as a plain string. WEB callers
   * should leave this empty and pass `endpoint` + `keys` instead — the
   * controller will serialize them into a single token blob.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pushToken?: string;

  /** Web Push API endpoint URL (returned by `pushManager.subscribe()`). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpoint?: string;

  @ApiPropertyOptional({ type: WebPushKeysDto })
  @IsOptional()
  @IsObject()
  keys?: WebPushKeysDto;

  @ApiPropertyOptional({ enum: ['EN', 'RU'] })
  @IsOptional()
  @IsEnum(['EN', 'RU'])
  locale?: 'EN' | 'RU';
}
