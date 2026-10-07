import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeedbackKind, FeedbackSource, FeedbackStatus } from '@prisma/client';
import { FEEDBACK_CONTACT_MAX_LENGTH, FEEDBACK_MESSAGE_MAX_LENGTH } from '@takeaway/shared-types';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Optional text: blank is the same as left out. */
const trimOrDrop = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class CreateFeedbackDto {
  @ApiProperty({ enum: FeedbackKind })
  @IsEnum(FeedbackKind)
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

  @ApiProperty({ enum: FeedbackSource })
  @IsEnum(FeedbackSource)
  source!: FeedbackSource;

  @ApiPropertyOptional({ example: '1.2.0 (3)' })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
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
  @ApiProperty({ enum: FeedbackSource }) source!: FeedbackSource;
  @ApiProperty({ nullable: true, type: String }) appVersion!: string | null;
  @ApiProperty({ enum: FeedbackStatus }) status!: FeedbackStatus;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) readAt!: string | null;
  @ApiProperty({ nullable: true, type: () => FeedbackAuthorDto }) author!: FeedbackAuthorDto | null;
}

export class AdminFeedbackPageDto {
  @ApiProperty({ type: () => AdminFeedbackDto, isArray: true }) items!: AdminFeedbackDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ description: 'Unread feedback, whatever the filter — the sidebar badge.' }) newCount!: number;
}
