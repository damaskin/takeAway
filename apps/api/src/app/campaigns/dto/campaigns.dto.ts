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

/** The copy of a campaign that is not saved yet, sent to the admin themselves. */
export class TestCampaignDto {
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
}

/** People each transport reached in one campaign. */
export class CampaignViaCountsDto {
  @ApiProperty({ description: 'iOS app, straight through Apple' })
  apns!: number;

  @ApiProperty({ description: 'Mobile app through Firebase (Android; iOS on older app versions)' })
  fcm!: number;

  @ApiProperty({ description: 'Browser push' })
  webpush!: number;

  @ApiProperty({ description: 'Telegram bot' })
  telegram!: number;

  @ApiProperty()
  email!: number;
}

export class CampaignErrorCountDto {
  @ApiProperty({ description: 'Delivery error as the transport reported it' })
  error!: string;

  @ApiProperty({ description: 'Recipients it happened to' })
  count!: number;
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

  @ApiProperty({ description: 'Recipients with no push token, Telegram chat or email to deliver to' })
  noChannelCount!: number;

  @ApiProperty({ description: 'Recipients who turned promotions off' })
  optedOutCount!: number;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Last delivery error or why the run failed' })
  lastError!: string | null;

  @ApiProperty({
    type: CampaignViaCountsDto,
    description: 'Recipients each transport reached; someone reached on two transports counts in both',
  })
  via!: CampaignViaCountsDto;

  @ApiProperty({
    type: CampaignErrorCountDto,
    isArray: true,
    description:
      'Most common delivery errors (up to 3), including app pushes that failed before a Telegram fallback landed',
  })
  errors!: CampaignErrorCountDto[];

  @ApiProperty({ description: 'Send may be pressed again: a draft, a failed or stuck run, or a run with failures' })
  sendable!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  startedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  sentAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

class CampaignReachByChannelDto {
  @ApiProperty({ description: 'Mobile app push (APNs for iOS, FCM)' })
  appPush!: number;

  @ApiProperty({ description: 'Browser push' })
  webPush!: number;

  @ApiProperty({ description: 'Telegram bot (for PUSH: people without app/web push)' })
  telegram!: number;

  @ApiProperty()
  email!: number;
}

class CampaignTransportsDto {
  @ApiProperty({ description: 'An APNs key is set (APNS_* or APPLE_*): iOS is pushed straight through Apple' })
  apns!: boolean;

  @ApiProperty({ description: 'FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY are set' })
  fcm!: boolean;

  @ApiProperty({ description: 'VAPID keys are set' })
  webpush!: boolean;

  @ApiProperty({ description: 'TELEGRAM_BOT_TOKEN is set' })
  telegram!: boolean;

  @ApiProperty({ description: 'SMTP_HOST is set' })
  email!: boolean;
}

export class CampaignPreviewDto {
  @ApiProperty({ description: 'Everyone the audience matches' })
  total!: number;

  @ApiProperty({ description: 'Of those, how many some channel can reach' })
  reachable!: number;

  @ApiProperty()
  optedOut!: number;

  @ApiProperty()
  noChannel!: number;

  @ApiProperty({ type: CampaignReachByChannelDto })
  byChannel!: CampaignReachByChannelDto;

  @ApiProperty({ type: CampaignTransportsDto })
  transports!: CampaignTransportsDto;
}

export class CampaignTestResultDto {
  @ApiProperty({ enum: ['sent', 'failed', 'no_channel'] })
  outcome!: 'sent' | 'failed' | 'no_channel';

  @ApiProperty({ type: String, isArray: true, description: 'apns, fcm, webpush, telegram, email' })
  via!: string[];

  @ApiPropertyOptional()
  error?: string;
}

export { AUDIENCES as CAMPAIGN_AUDIENCES, CHANNELS as CAMPAIGN_CHANNELS };
