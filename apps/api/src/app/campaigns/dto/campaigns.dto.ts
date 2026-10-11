import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const CHANNELS = ['PUSH', 'TELEGRAM', 'EMAIL'] as const;
const AUDIENCES = ['ALL', 'HAS_ORDERED', 'INACTIVE_30D'] as const;
const STATUSES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SENDING', 'SENT', 'FAILED'] as const;
const MODERATION_VIEWS = ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;

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

  /**
   * Send no earlier than this (ISO 8601). Left out or null: as soon as it is
   * approved. Must still be ahead when the campaign is submitted.
   */
  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-10-12T09:00:00.000Z' })
  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledAt?: string | null;
}

/** A draft or a rejected campaign changes; any field left out stays. `scheduledAt: null` clears the time. */
export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}

/** The reason goes to the business as it is. */
export class RejectCampaignDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
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

  @ApiProperty({
    description: 'Retry may be pressed: an approved campaign with a failed or stuck run, or with failures',
  })
  sendable!: boolean;

  @ApiProperty({ description: 'A draft or a rejected campaign: it can be edited and submitted for review' })
  editable!: boolean;

  @ApiProperty({ description: 'Nothing has gone out yet, so it can be deleted' })
  deletable!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Send no earlier than this' })
  scheduledAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Last time it went into the review queue' })
  submittedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: "The moderator's last decision" })
  reviewedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Why it was rejected — shown to the business' })
  reviewNote!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'When it was approved; nothing is sent before' })
  approvedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  startedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  sentAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

class CampaignBrandDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) logoUrl!: string | null;
}

class CampaignPersonDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) name!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) email!: string | null;
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

/** A campaign in the platform admin's moderation queue or history. */
export class CampaignModerationDto extends CampaignDto {
  @ApiProperty({ type: CampaignBrandDto })
  brand!: CampaignBrandDto;

  @ApiPropertyOptional({ type: CampaignPersonDto, nullable: true, description: 'Who composed it' })
  createdBy!: CampaignPersonDto | null;

  @ApiPropertyOptional({ type: CampaignPersonDto, nullable: true, description: 'Who decided' })
  reviewedBy!: CampaignPersonDto | null;

  @ApiPropertyOptional({
    type: CampaignPreviewDto,
    nullable: true,
    description: 'Who it reaches right now — for campaigns waiting for review only',
  })
  reach!: CampaignPreviewDto | null;
}

export class CampaignModerationQueryDto {
  @ApiPropertyOptional({ enum: MODERATION_VIEWS, default: 'PENDING_REVIEW' })
  @IsOptional()
  @IsEnum(MODERATION_VIEWS)
  view?: (typeof MODERATION_VIEWS)[number];
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
