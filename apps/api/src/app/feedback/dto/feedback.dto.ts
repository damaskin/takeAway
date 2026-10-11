import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeedbackKind, FeedbackSource, FeedbackStatus } from '@prisma/client';
import {
  FEEDBACK_CONTACT_MAX_LENGTH,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_NAME_MAX_LENGTH,
  FEEDBACK_SOURCES,
  SUPPORT_TOPICS,
} from '@takeaway/shared-types';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Optional text: blank is the same as left out. */
const trimOrDrop = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** A customer's own feedback: the customer kinds, from a customer client. */
export class CreateFeedbackDto {
  @ApiProperty({ enum: FEEDBACK_KINDS })
  @IsIn(FEEDBACK_KINDS)
  kind!: FeedbackKind;

  @ApiProperty({ maxLength: FEEDBACK_MESSAGE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(FEEDBACK_MESSAGE_MAX_LENGTH)
  message!: string;

  @ApiPropertyOptional({
    maxLength: FEEDBACK_CONTACT_MAX_LENGTH,
    description: "How to reach the customer, when it is not the account's own contacts.",
  })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(FEEDBACK_CONTACT_MAX_LENGTH)
  contact?: string;

  @ApiProperty({ enum: FEEDBACK_SOURCES })
  @IsIn(FEEDBACK_SOURCES)
  source!: FeedbackSource;

  @ApiPropertyOptional({ example: '1.2.0 (3)' })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

/** «Написать в поддержку» from the business admin: a topic and the message. */
export class CreateSupportDto {
  @ApiProperty({ enum: SUPPORT_TOPICS })
  @IsIn(SUPPORT_TOPICS)
  kind!: FeedbackKind;

  @ApiProperty({ maxLength: FEEDBACK_MESSAGE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(FEEDBACK_MESSAGE_MAX_LENGTH)
  message!: string;
}

/**
 * The site's «Поддержка» form. Whether `contact` is required depends on who
 * sends it (a visitor without an account must leave one), so the service
 * checks that, and reads it as an email or a phone.
 */
export class CreateSiteSupportDto {
  @ApiProperty({ enum: SUPPORT_TOPICS })
  @IsIn(SUPPORT_TOPICS)
  kind!: FeedbackKind;

  @ApiProperty({ maxLength: FEEDBACK_MESSAGE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(FEEDBACK_MESSAGE_MAX_LENGTH)
  message!: string;

  @ApiPropertyOptional({ maxLength: FEEDBACK_NAME_MAX_LENGTH })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(FEEDBACK_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    maxLength: FEEDBACK_CONTACT_MAX_LENGTH,
    description: 'An email or a phone number. Required without an account (`SUPPORT_CONTACT_REQUIRED`).',
  })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(FEEDBACK_CONTACT_MAX_LENGTH)
  contact?: string;

  /**
   * Honeypot: the form hides this field from people, so a value means a bot
   * filled every input it found. Such a request is answered like any other
   * and dropped.
   */
  @ApiPropertyOptional({ description: 'Leave empty.' })
  @IsOptional()
  @IsString()
  @MaxLength(FEEDBACK_CONTACT_MAX_LENGTH)
  website?: string;
}

export class FeedbackReceiptDto {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: string;
}

export class AdminFeedbackQueryDto {
  @ApiPropertyOptional({ enum: FeedbackStatus, description: 'Only this status; without it, everything not archived.' })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({ enum: FeedbackKind })
  @IsOptional()
  @IsEnum(FeedbackKind)
  kind?: FeedbackKind;

  @ApiPropertyOptional({ enum: FeedbackSource, description: 'BUSINESS: only what businesses wrote from the admin.' })
  @IsOptional()
  @IsEnum(FeedbackSource)
  source?: FeedbackSource;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class UpdateFeedbackStatusDto {
  @ApiProperty({ enum: FeedbackStatus })
  @IsEnum(FeedbackStatus)
  status!: FeedbackStatus;
}

export class FeedbackAuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Telegram user id as a string.' })
  telegramUserId!: string | null;
  @ApiProperty({ description: 'The account was deleted; its contacts are gone.' }) deleted!: boolean;
}

export class AdminFeedbackDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: FeedbackKind }) kind!: FeedbackKind;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true, type: String }) contact!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The name a visitor without an account gave on the site support form.',
  })
  name!: string | null;
  @ApiProperty({ enum: FeedbackSource }) source!: FeedbackSource;
  @ApiProperty({ nullable: true, type: String }) appVersion!: string | null;
  @ApiProperty({ enum: FeedbackStatus }) status!: FeedbackStatus;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) readAt!: string | null;
  @ApiProperty({
    nullable: true,
    type: () => FeedbackAuthorDto,
    description: 'Null for a visitor without an account, and when the account is gone.',
  })
  author!: FeedbackAuthorDto | null;
  @ApiProperty({
    nullable: true,
    type: () => FeedbackBrandDto,
    description: 'Set on messages from the business admin.',
  })
  brand!: FeedbackBrandDto | null;
}

export class FeedbackBrandDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String, description: 'E.164' }) contactPhone!: string | null;
}

export class AdminFeedbackPageDto {
  @ApiProperty({ type: () => AdminFeedbackDto, isArray: true }) items!: AdminFeedbackDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ description: 'Unread feedback, whatever the filter — the sidebar badge.' }) newCount!: number;
}
