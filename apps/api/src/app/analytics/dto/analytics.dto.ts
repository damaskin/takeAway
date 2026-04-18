import { ApiProperty } from '@nestjs/swagger';

export class RevenuePointDto {
  @ApiProperty() date!: string;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orderCount!: number;
}

export class RevenueSeriesDto {
  @ApiProperty() totalRevenueCents!: number;
  @ApiProperty() totalOrders!: number;
  @ApiProperty() avgBasketCents!: number;
  @ApiProperty({ required: false, nullable: true }) bestDay!: RevenuePointDto | null;
  /** Same-period delta vs the previous window (e.g. prior 14 days). */
  @ApiProperty() revenueDeltaPercent!: number;
  @ApiProperty({ type: () => RevenuePointDto, isArray: true }) points!: RevenuePointDto[];
}

export class TopProductDto {
  @ApiProperty() name!: string;
  @ApiProperty() unitsSold!: number;
  @ApiProperty() revenueCents!: number;
}

export class CohortStatsDto {
  @ApiProperty() repeatRatePercent!: number;
  @ApiProperty() avgBasketCents!: number;
  @ApiProperty() newCustomers!: number;
  @ApiProperty() pickupSlaPercent!: number;
}

export class StorePerformanceDto {
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orders!: number;
  /** Share of total revenue in the period, 0..100. */
  @ApiProperty() sharePercent!: number;
}

export class DashboardSummaryDto {
  @ApiProperty() revenueTodayCents!: number;
  @ApiProperty() ordersToday!: number;
  @ApiProperty() avgPickupSeconds!: number;
  @ApiProperty() nps!: number;
  /** Same-period deltas vs yesterday, as percent strings like "+12.3%". */
  @ApiProperty() deltas!: Record<string, string>;
}
