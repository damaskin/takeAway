import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ORDER_REVIEW_COMMENT_MAX_LENGTH } from '@takeaway/shared-types';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Optional text: trimmed, and blank is the same as left out. */
const trimOrDrop = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** «Как вам заказ?» — the stars and, if the customer likes, a few words. */
export class CreateOrderReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ maxLength: ORDER_REVIEW_COMMENT_MAX_LENGTH, description: 'Blank is the same as left out.' })
  @Transform(trimOrDrop)
  @IsOptional()
  @IsString()
  @MaxLength(ORDER_REVIEW_COMMENT_MAX_LENGTH)
  comment?: string;
}

export class AdminOrderReviewQueryDto {
  @ApiPropertyOptional({ description: 'Only this brand; without it, every brand.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  brandId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Only reviews with these stars.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'ISO instant, inclusive.', example: '2026-11-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'ISO instant, exclusive.', example: '2026-11-08T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

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

export class OrderReviewCustomerDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: "The account's name, else the name given at checkout; null after account deletion.",
  })
  name!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Telegram user id as a string.' })
  telegramUserId!: string | null;
  @ApiProperty({ description: 'The account was deleted; its contacts are gone, the review stays.' })
  deleted!: boolean;
}

export class OrderReviewRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class AdminOrderReviewDto {
  @ApiProperty() id!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) rating!: number;
  @ApiProperty({ nullable: true, type: String }) comment!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderCode!: string;
  @ApiProperty({ type: () => OrderReviewRefDto }) brand!: OrderReviewRefDto;
  @ApiProperty({ type: () => OrderReviewRefDto }) store!: OrderReviewRefDto;
  @ApiProperty({ type: () => OrderReviewCustomerDto }) customer!: OrderReviewCustomerDto;
}

export class OrderReviewRatingCountsDto {
  @ApiProperty() '1'!: number;
  @ApiProperty() '2'!: number;
  @ApiProperty() '3'!: number;
  @ApiProperty() '4'!: number;
  @ApiProperty() '5'!: number;
}

export class AdminOrderReviewPageDto {
  @ApiProperty({ type: () => AdminOrderReviewDto, isArray: true }) items!: AdminOrderReviewDto[];
  @ApiProperty({ description: 'Reviews matching every filter, rating included.' }) total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ description: 'Reviews in the brand and period, whatever the rating filter.' }) count!: number;
  @ApiProperty({ nullable: true, type: Number, description: 'Their average, to one decimal; null without any.' })
  averageRating!: number | null;
  @ApiProperty({ type: () => OrderReviewRatingCountsDto, description: 'How many gave each rating.' })
  ratingCounts!: OrderReviewRatingCountsDto;
}
