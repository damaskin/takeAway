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

/**
 * The dashboard's figures over the last `days` calendar days (UTC, today
 * included), each compared with the `days` before them. Deltas are numbers,
 * not preformatted strings, so the admin can write them in its own language.
 */
export class DashboardSummaryDto {
  @ApiProperty() days!: number;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() avgPickupSeconds!: number;
  /** Null until customer ratings are collected. */
  @ApiProperty({ nullable: true, type: Number }) nps!: number | null;
  /** Percent change; null when the period before had nothing to compare with. */
  @ApiProperty({ nullable: true, type: Number }) revenueDeltaPercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) ordersDeltaPercent!: number | null;
  /** Change of the average pickup time, in seconds; null unless both periods have one. */
  @ApiProperty({ nullable: true, type: Number }) pickupDeltaSeconds!: number | null;
}

export class OrderStatusPeriodDto {
  /** Orders placed in the period, whatever became of them. */
  @ApiProperty() total!: number;
  /** Picked up or delivered. */
  @ApiProperty() completed!: number;
  @ApiProperty() cancelled!: number;
  /** Never accepted in time. */
  @ApiProperty() expired!: number;
  /** Completed among the orders that have finished, 0..100; null when none has. */
  @ApiProperty({ nullable: true, type: Number }) completionRatePercent!: number | null;
  /** Count per `OrderStatus`, every status present. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) byStatus!: Record<string, number>;
}

export class OrderStatusStatsDto {
  @ApiProperty() days!: number;
  /** Orders in each open status right now, regardless of the period. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) live!: Record<string, number>;
  @ApiProperty() liveTotal!: number;
  @ApiProperty({ type: () => OrderStatusPeriodDto }) period!: OrderStatusPeriodDto;
}

export class BrandPerformanceDto {
  @ApiProperty() brandId!: string;
  @ApiProperty() brandName!: string;
  /** Revenue is in the brand's own currency; brands are not summed across currencies. */
  @ApiProperty() currency!: string;
  @ApiProperty() moderationStatus!: string;
  @ApiProperty() stores!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() revenueCents!: number;
}
