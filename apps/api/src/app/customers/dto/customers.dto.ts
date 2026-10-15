import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { CUSTOMER_SEGMENTS, type CustomerSegment, INACTIVE_DAYS, type InactiveDays } from '../customer-segment';
import { PRODUCT_KINDS, type ProductKind } from '../product-kind';

export const CUSTOMER_SORTS = [
  'lastOrderAt',
  'firstOrderAt',
  'orders',
  'totalCents',
  'avgCheckCents',
  'frequency',
] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export class CustomersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Only orders at this store count.' })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({
    description:
      'The currency spend is shown in when the stores price in several. People are counted over every store either way.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Name, phone or email, as on the account or typed at checkout.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: CUSTOMER_SEGMENTS,
    default: 'all',
    description: 'regular — 3+ orders; inactive — 3+ orders and none for `inactiveDays` days.',
  })
  @IsOptional()
  @IsIn([...CUSTOMER_SEGMENTS])
  segment?: CustomerSegment;

  @ApiPropertyOptional({
    enum: INACTIVE_DAYS,
    default: 14,
    description: 'Days without an order, for segment=inactive.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([...INACTIVE_DAYS])
  inactiveDays?: InactiveDays;

  @ApiPropertyOptional({ enum: CUSTOMER_SORTS, default: 'lastOrderAt' })
  @IsOptional()
  @IsIn([...CUSTOMER_SORTS])
  sort?: CustomerSort;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

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

export class CustomerScopeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({ description: 'The currency spend is shown in when the stores price in several.' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}

/** A product one customer keeps ordering: at least 5 units across their counted orders. */
export class FavouriteProductDto {
  @ApiProperty({ description: 'The name it was last sold under' }) name!: string;
  @ApiProperty({ description: 'Units across the counted orders' }) quantity!: number;
  @ApiProperty({
    enum: PRODUCT_KINDS,
    nullable: true,
    type: String,
    description: 'Drink or food, read from caffeine, drink options and the category; null when unclear',
  })
  kind!: ProductKind | null;
}

/** One customer's history with the business. Cancelled and expired orders do not count. */
export class CustomerSummaryDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty() orders!: number;
  /** Spend: the revenue of their orders — menu prices less discounts, gift-card payments included. */
  @ApiProperty() totalCents!: number;
  @ApiProperty() avgCheckCents!: number;
  @ApiProperty() firstOrderAt!: string;
  @ApiProperty() lastOrderAt!: string;
  /** Average days between two orders; null with a single order. */
  @ApiProperty({ nullable: true, type: Number }) avgDaysBetweenOrders!: number | null;
  @ApiProperty() daysSinceLastOrder!: number;
  @ApiProperty({ nullable: true, type: String }) favouriteStoreId!: string | null;
  @ApiProperty({ nullable: true, type: String }) favouriteStoreName!: string | null;
  /** Their most ordered product once it reached 5 units; null before that. */
  @ApiProperty({ nullable: true, type: () => FavouriteProductDto }) favouriteProduct!: FavouriteProductDto | null;
}

/** Of the people counted by `LapsedAtOneStoreDto`, those of one store. */
export class StoreLapsedCountDto {
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() count!: number;
}

/**
 * Regulars inactive at one of the stores (3+ orders there, none for the
 * window) who still order at another — so they are not inactive across the
 * brand and are not in the brand-wide list.
 */
export class LapsedAtOneStoreDto {
  @ApiProperty({ description: 'People, each once' }) count!: number;
  @ApiProperty({ type: () => StoreLapsedCountDto, isArray: true }) stores!: StoreLapsedCountDto[];
}

export class CustomerPageDto {
  @ApiProperty({ type: () => CustomerSummaryDto, isArray: true }) items!: CustomerSummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  /** The currency of `totalCents` and `avgCheckCents`; spend in other currencies is not in them. */
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  /** Every currency the stores price in; more than one — the page offers a choice. */
  @ApiProperty({ type: String, isArray: true }) currencies!: string[];
  /** On the brand-wide inactive list only: who went quiet at one store but orders at another. */
  @ApiProperty({ nullable: true, type: () => LapsedAtOneStoreDto }) activeElsewhere!: LapsedAtOneStoreDto | null;
}

export class CustomerStoreDto {
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
  /** The store's currency, which `totalCents` is in. */
  @ApiProperty() currency!: string;
  @ApiProperty() orders!: number;
  @ApiProperty() totalCents!: number;
}

export class CustomerOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderCode!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() status!: string;
  /** The order's revenue, on the same basis as the customer's spend. */
  @ApiProperty() totalCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() itemCount!: number;
}

export class CustomerDetailDto extends CustomerSummaryDto {
  /** The currency of the spend and average check above. */
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  /** Cancelled or expired orders, which the totals leave out. */
  @ApiProperty() cancelledOrders!: number;
  @ApiProperty({ type: () => CustomerStoreDto, isArray: true }) stores!: CustomerStoreDto[];
  /** Every product they ordered 5 units of or more, most ordered first. */
  @ApiProperty({ type: () => FavouriteProductDto, isArray: true }) favourites!: FavouriteProductDto[];
  /** The latest orders, newest first, every status. */
  @ApiProperty({ type: () => CustomerOrderDto, isArray: true }) recentOrders!: CustomerOrderDto[];
}
