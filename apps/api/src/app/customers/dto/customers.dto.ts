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

export class CustomerPageDto {
  @ApiProperty({ type: () => CustomerSummaryDto, isArray: true }) items!: CustomerSummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class CustomerStoreDto {
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() orders!: number;
  @ApiProperty() totalCents!: number;
}

export class CustomerOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderCode!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() status!: string;
  @ApiProperty() totalCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() itemCount!: number;
}

export class CustomerDetailDto extends CustomerSummaryDto {
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  /** Cancelled or expired orders, which the totals leave out. */
  @ApiProperty() cancelledOrders!: number;
  @ApiProperty({ type: () => CustomerStoreDto, isArray: true }) stores!: CustomerStoreDto[];
  /** Every product they ordered 5 units of or more, most ordered first. */
  @ApiProperty({ type: () => FavouriteProductDto, isArray: true }) favourites!: FavouriteProductDto[];
  /** The latest orders, newest first, every status. */
  @ApiProperty({ type: () => CustomerOrderDto, isArray: true }) recentOrders!: CustomerOrderDto[];
}
