import { ApiProperty } from '@nestjs/swagger';

export class RevenuePointDto {
  @ApiProperty() date!: string;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orderCount!: number;
}

/** The days a figure covers, as the API read them. */
export class AnalyticsPeriodDto {
  /** First day, local to the scope's time zone. */
  @ApiProperty() from!: string;
  /** Last day, included. */
  @ApiProperty() to!: string;
  @ApiProperty() timeZone!: string;
}

export class RevenueSeriesDto extends AnalyticsPeriodDto {
  @ApiProperty() totalRevenueCents!: number;
  @ApiProperty() totalOrders!: number;
  @ApiProperty() avgBasketCents!: number;
  @ApiProperty({ required: false, nullable: true }) bestDay!: RevenuePointDto | null;
  /** Same-period delta vs the previous window (e.g. prior 14 days). */
  @ApiProperty() revenueDeltaPercent!: number;
  @ApiProperty() previousRevenueCents!: number;
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

/**
 * One store over the period. Every plan gets revenue and orders; the fields
 * after them are the PRO comparison and stay null on BASIC.
 */
export class StorePerformanceDto {
  @ApiProperty() storeId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orders!: number;
  /** Share of total revenue in the period, 0..100, one decimal. */
  @ApiProperty() sharePercent!: number;
  /** False on a plan without store comparison: the fields below are null. */
  @ApiProperty() detailed!: boolean;
  /** Share of the period's orders, 0..100. */
  @ApiProperty({ nullable: true, type: Number }) ordersSharePercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) avgCheckCents!: number | null;
  /** READY to PICKED_UP, like the dashboard's pickup time. */
  @ApiProperty({ nullable: true, type: Number }) avgPickupSeconds!: number | null;
  /** Accepted (or placed) to READY. */
  @ApiProperty({ nullable: true, type: Number }) avgPrepSeconds!: number | null;
  @ApiProperty({ nullable: true, type: Number }) cancelled!: number | null;
  @ApiProperty({ nullable: true, type: Number }) expired!: number | null;
  /** Cancelled and expired among the orders placed, 0..100. */
  @ApiProperty({ nullable: true, type: Number }) cancelRatePercent!: number | null;
  /** Distinct customers with a counted order. */
  @ApiProperty({ nullable: true, type: Number }) customers!: number | null;
  /** Employees who moved at least one of the period's orders along. */
  @ApiProperty({ nullable: true, type: Number }) staff!: number | null;
  @ApiProperty({ nullable: true, type: Number }) ordersPerStaff!: number | null;
  @ApiProperty({ nullable: true, type: Number }) previousRevenueCents!: number | null;
  @ApiProperty({ nullable: true, type: Number }) revenueDeltaPercent!: number | null;
}

/** One employee over the period, from the order timeline and the shift log. */
export class StaffPerformanceDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty() role!: string;
  /** Orders this person accepted. */
  @ApiProperty() accepted!: number;
  /** Orders this person marked ready. */
  @ApiProperty() ready!: number;
  /** Orders this person handed over (picked up or delivered). */
  @ApiProperty() completed!: number;
  /** Distinct orders this person moved at all. */
  @ApiProperty() handled!: number;
  /** Shifts this person opened. */
  @ApiProperty() shifts!: number;
  /** Hours of those shifts inside the period, one decimal. */
  @ApiProperty() shiftHours!: number;
  /** Handed-over orders per shift hour; null without shift hours. */
  @ApiProperty({ nullable: true, type: Number }) ordersPerHour!: number | null;
}

export class RetentionCustomerDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty() orders!: number;
  @ApiProperty() totalCents!: number;
  @ApiProperty() avgCheckCents!: number;
  @ApiProperty() lastOrderAt!: string;
  @ApiProperty() daysSinceLastOrder!: number;
}

export class ChurnPeriodDto {
  @ApiProperty() count!: number;
  @ApiProperty() lostRevenueCents!: number;
}

/**
 * Customers lost in the period: `window` days went by after their last
 * order without another one. Money is the sum of their average checks,
 * roughly what one more visit from each would have brought.
 */
export class ChurnDto extends AnalyticsPeriodDto {
  @ApiProperty({ enum: [7, 14] }) window!: number;
  @ApiProperty() count!: number;
  @ApiProperty() lostRevenueCents!: number;
  @ApiProperty({ type: () => ChurnPeriodDto }) previous!: ChurnPeriodDto;
  @ApiProperty({ nullable: true, type: Number }) countDeltaPercent!: number | null;
  /** The lost customers, highest average check first. Null on a plan without the list. */
  @ApiProperty({ type: () => RetentionCustomerDto, isArray: true, nullable: true })
  customers!: RetentionCustomerDto[] | null;
}

export class WinBackPeriodDto {
  /** Customers already lost when the period began. */
  @ApiProperty() lapsedAtStart!: number;
  /** Of those, how many ordered again during the period. */
  @ApiProperty() returned!: number;
  @ApiProperty({ nullable: true, type: Number }) returnRatePercent!: number | null;
  @ApiProperty() orders!: number;
  @ApiProperty() revenueCents!: number;
}

export class WinBackCustomerDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty() lastOrderBefore!: string;
  @ApiProperty() returnedAt!: string;
  @ApiProperty() daysAway!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() revenueCents!: number;
}

export class WinBackDto extends AnalyticsPeriodDto {
  @ApiProperty({ enum: [7, 14] }) window!: number;
  @ApiProperty({ type: () => WinBackPeriodDto }) current!: WinBackPeriodDto;
  @ApiProperty({ type: () => WinBackPeriodDto }) previous!: WinBackPeriodDto;
  @ApiProperty({ nullable: true, type: Number }) returnedDeltaPercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) revenueDeltaPercent!: number | null;
  /** The returned customers, biggest spenders first. */
  @ApiProperty({ type: () => WinBackCustomerDto, isArray: true }) customers!: WinBackCustomerDto[];
}

/**
 * The dashboard's figures over a range of calendar days in the scope's time
 * zone, each compared with as many days right before. Deltas are numbers,
 * not preformatted strings, so the admin can write them in its own language.
 */
export class DashboardSummaryDto extends AnalyticsPeriodDto {
  /** Length of the range in days. */
  @ApiProperty() days!: number;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() avgCheckCents!: number;
  @ApiProperty() avgPickupSeconds!: number;
  /** Null until customer ratings are collected. */
  @ApiProperty({ nullable: true, type: Number }) nps!: number | null;
  /** Percent change; null when the period before had nothing to compare with. */
  @ApiProperty({ nullable: true, type: Number }) revenueDeltaPercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) ordersDeltaPercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) avgCheckDeltaPercent!: number | null;
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

export class OrderStatusStatsDto extends AnalyticsPeriodDto {
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
