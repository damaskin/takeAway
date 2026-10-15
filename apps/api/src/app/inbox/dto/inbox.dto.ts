import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  INBOX_PAGE_MAX,
  INBOX_PAGE_SIZE,
  type InboxItem,
  type InboxItemKind,
  type InboxLink,
  type InboxPage,
  type InboxSender,
} from '@takeaway/shared-types';

const KINDS: readonly InboxItemKind[] = ['BRAND_CAMPAIGN', 'PLATFORM_ANNOUNCEMENT'];

export class InboxQueryDto {
  @ApiPropertyOptional({ description: '`nextCursor` of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: INBOX_PAGE_MAX, default: INBOX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INBOX_PAGE_MAX)
  limit?: number;
}

export class InboxSenderDto implements InboxSender {
  @ApiProperty({ enum: ['BRAND', 'PLATFORM'], description: 'PLATFORM — takeAway itself' })
  kind!: 'BRAND' | 'PLATFORM';

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: "The brand's logo; null for the platform" })
  logoUrl!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  brandId!: string | null;
}

export class InboxLinkDto implements InboxLink {
  @ApiProperty({ enum: ['STORE', 'BRAND'] })
  kind!: 'STORE' | 'BRAND';

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'The store whose menu opens. BRAND: its store when it has exactly one open to customers, otherwise null — show the list of places',
  })
  storeId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  storeSlug!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  brandId!: string | null;

  @ApiProperty({ description: "The store's or the brand's name" })
  name!: string;
}

export class InboxItemDto implements InboxItem {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: KINDS })
  kind!: InboxItemKind;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ type: InboxSenderDto })
  sender!: InboxSenderDto;

  @ApiPropertyOptional({
    type: InboxLinkDto,
    nullable: true,
    description: 'Where a tap leads; null when the message links nothing (or its store has closed)',
  })
  link!: InboxLinkDto | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Null until opened' })
  readAt!: string | null;
}

export class InboxPageDto implements InboxPage {
  @ApiProperty({ type: InboxItemDto, isArray: true, description: 'Newest first' })
  items!: InboxItemDto[];

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Pass as `cursor`; null on the last page' })
  nextCursor!: string | null;

  @ApiProperty()
  unreadCount!: number;
}

export class InboxCountDto {
  @ApiProperty()
  count!: number;
}
