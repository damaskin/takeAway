import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
   * The FCM token of the mobile app (iOS and Android) as a plain string.
   * WEB callers leave this empty and pass `endpoint` + `keys` instead — the
   * service serializes them into a single token blob.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pushToken?: string;

  /**
   * iOS only: the raw APNs device token, hex. The API pushes to it directly
   * when APNs is configured and skips the FCM token of the same device.
   * Older app versions do not send it and stay on FCM.
   */
  @ApiPropertyOptional({ description: 'iOS: raw APNs device token, hex' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]{32,512}$/, { message: 'apnsToken must be a hex APNs device token' })
  apnsToken?: string;

  /** Which APNs gateway the token belongs to: PRODUCTION for store / TestFlight builds, SANDBOX for debug ones. */
  @ApiPropertyOptional({ enum: ['PRODUCTION', 'SANDBOX'], default: 'PRODUCTION' })
  @IsOptional()
  @IsEnum(['PRODUCTION', 'SANDBOX'])
  apnsEnvironment?: 'PRODUCTION' | 'SANDBOX';

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
