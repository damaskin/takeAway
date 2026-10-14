import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED'] as const;

const emptyToNull = ({ value }: { value: unknown }): unknown => (value === '' ? null : value);

/** The copy and the link — what a test send and a saved announcement share. */
export class AnnouncementCopyDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ minLength: 2, maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "A tap opens this store's menu" })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  linkStoreId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "A tap opens this brand's menu (its store when it has one, else the list of places)",
  })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  linkBrandId?: string | null;
}

export class CreateAnnouncementDto extends AnnouncementCopyDto {
  /** Send at this time (ISO 8601). Left out or null: «Отправить» sends at once. */
  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-10-15T09:00:00.000Z' })
  @Transform(emptyToNull)
  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledAt?: string | null;
}

/** A draft changes; any field left out stays, null clears a link or the time. */
export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}

/** The copy sent to the admin themselves. */
export class TestAnnouncementDto extends AnnouncementCopyDto {}

class AnnouncementLinkDto {
  @ApiProperty({ enum: ['STORE', 'BRAND'] })
  kind!: 'STORE' | 'BRAND';

  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'STORE: whose store it is' })
  brandName!: string | null;
}

class AnnouncementViaCountsDto {
  @ApiProperty({ description: 'iOS app, straight through Apple' })
  apns!: number;

  @ApiProperty({ description: 'Mobile app through Firebase' })
  fcm!: number;

  @ApiProperty({ description: 'Browser push' })
  webpush!: number;

  @ApiProperty({ description: 'Telegram bot (people without app or web push)' })
  telegram!: number;
}

class AnnouncementErrorCountDto {
  @ApiProperty()
  error!: string;

  @ApiProperty()
  count!: number;
}

class AnnouncementPersonDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) name!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) email!: string | null;
}

export class AnnouncementDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  linkStoreId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  linkBrandId!: string | null;

  @ApiPropertyOptional({
    type: AnnouncementLinkDto,
    nullable: true,
    description: 'The linked store or brand by name; null when none, or it no longer exists',
  })
  link!: AnnouncementLinkDto | null;

  @ApiProperty({ enum: STATUSES })
  status!: (typeof STATUSES)[number];

  @ApiProperty({ description: 'Recipients when the run started: customers who allow promotions' })
  targetCount!: number;

  @ApiProperty({ description: 'Recipients a push reached' })
  sentCount!: number;

  @ApiProperty({ description: 'Recipients whose push failed — they still have it in «Уведомления»' })
  failedCount!: number;

  @ApiProperty({ description: 'Recipients no push could reach — «Уведомления» only' })
  noChannelCount!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastError!: string | null;

  @ApiProperty({ type: AnnouncementViaCountsDto })
  via!: AnnouncementViaCountsDto;

  @ApiProperty({ type: AnnouncementErrorCountDto, isArray: true, description: 'Most common push errors (up to 3)' })
  errors!: AnnouncementErrorCountDto[];

  @ApiProperty({ description: 'A draft: it can be edited and sent (or scheduled)' })
  editable!: boolean;

  @ApiProperty({ description: '«Повторить»: a failed or stuck run, or a finished one with failed pushes' })
  retryable!: boolean;

  @ApiProperty({ description: 'Scheduled: «Отменить отправку» returns it to a draft' })
  cancellable!: boolean;

  @ApiProperty({ description: 'Nothing has gone out yet' })
  deletable!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  scheduledAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  startedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  sentAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ type: AnnouncementPersonDto, nullable: true })
  createdBy!: AnnouncementPersonDto | null;
}

class AnnouncementReachByChannelDto {
  @ApiProperty() appPush!: number;
  @ApiProperty() webPush!: number;
  @ApiProperty({ description: 'People without app or web push who have a chat with the bot' })
  telegram!: number;
}

class AnnouncementTransportsDto {
  @ApiProperty() apns!: boolean;
  @ApiProperty() fcm!: boolean;
  @ApiProperty() webpush!: boolean;
  @ApiProperty() telegram!: boolean;
}

export class AnnouncementPreviewDto {
  @ApiProperty({ description: 'Every customer account' })
  customers!: number;

  @ApiProperty({ description: 'Customers who turned promotions off — they get nothing' })
  optedOut!: number;

  @ApiProperty({ description: 'Everyone else; each gets it in «Уведомления»' })
  recipients!: number;

  @ApiProperty({ description: 'Recipients a push reaches too' })
  pushReachable!: number;

  @ApiProperty({ description: 'Recipients only «Уведомления» reaches' })
  noChannel!: number;

  @ApiProperty({ type: AnnouncementReachByChannelDto })
  byChannel!: AnnouncementReachByChannelDto;

  @ApiProperty({ type: AnnouncementTransportsDto })
  transports!: AnnouncementTransportsDto;
}

export class AnnouncementTestResultDto {
  @ApiProperty({ enum: ['sent', 'failed', 'no_channel'] })
  outcome!: 'sent' | 'failed' | 'no_channel';

  @ApiProperty({ type: String, isArray: true, description: 'apns, fcm, webpush, telegram' })
  via!: string[];

  @ApiPropertyOptional()
  error?: string;
}
