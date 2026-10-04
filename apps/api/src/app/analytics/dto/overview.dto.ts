import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type {
  BusinessOverview,
  OverviewDay,
  OverviewHour,
  OverviewPeriod,
  OverviewRow,
  OverviewTotals,
  OverviewWeekday,
  PlatformBrandRow,
  PlatformOverview,
} from '@takeaway/shared-types';

import { AnalyticsQueryDto } from './analytics-query.dto';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'IDR', 'MDL', 'RUP'] as const;

/** The platform view's period and, when brands sell in several, which currency to show. */
export class PlatformOverviewQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: CURRENCIES, description: 'Defaults to the currency that sold the most.' })
  @IsOptional()
  @IsIn([...CURRENCIES])
  currency?: string;
}

export class OverviewPeriodDto implements OverviewPeriod {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() days!: number;
  @ApiProperty() timeZone!: string;
  @ApiProperty() previousFrom!: string;
  @ApiProperty() previousTo!: string;
}

export class OverviewTotalsDto implements OverviewTotals {
  @ApiProperty() revenueCents!: number;
  @ApiProperty({ description: 'Not cancelled, not expired.' }) orders!: number;
  @ApiProperty({ description: 'Every order placed.' }) placed!: number;
  @ApiProperty() customers!: number;
  @ApiProperty({ description: 'First counted order in the scope falls in the period.' }) newCustomers!: number;
  @ApiProperty({ nullable: true, type: Number }) avgCheckCents!: number | null;
  @ApiProperty() cancelled!: number;
  @ApiProperty() expired!: number;
  @ApiProperty({ nullable: true, type: Number }) cancelRatePercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) avgPickupSeconds!: number | null;
  @ApiProperty({ description: 'Stores (or brands) with a counted order.' }) activeUnits!: number;
  @ApiProperty() commissionCents!: number;
}

export class OverviewDayDto implements OverviewDay {
  @ApiProperty() date!: string;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() customers!: number;
  @ApiProperty() newCustomers!: number;
  @ApiProperty() cancelled!: number;
  @ApiProperty() expired!: number;
  @ApiProperty() commissionCents!: number;
}

export class OverviewHourDto implements OverviewHour {
  @ApiProperty({ minimum: 0, maximum: 23 }) hour!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() revenueCents!: number;
}

export class OverviewWeekdayDto implements OverviewWeekday {
  @ApiProperty({ minimum: 1, maximum: 7, description: '1 = Monday' }) weekday!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() revenueCents!: number;
}

export class OverviewRowDto implements OverviewRow {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() revenueCents!: number;
  @ApiProperty() orders!: number;
  @ApiProperty() sharePercent!: number;
  @ApiProperty() ordersSharePercent!: number;
  @ApiProperty({ description: 'False on a plan without store comparison: the fields below are null.' })
  detailed!: boolean;
  @ApiProperty({ nullable: true, type: Number }) previousRevenueCents!: number | null;
  @ApiProperty({ nullable: true, type: Number }) previousOrders!: number | null;
  @ApiProperty({ nullable: true, type: Number }) revenueDeltaPercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) avgCheckCents!: number | null;
  @ApiProperty({ nullable: true, type: Number }) customers!: number | null;
  @ApiProperty({ nullable: true, type: Number }) cancelled!: number | null;
  @ApiProperty({ nullable: true, type: Number }) expired!: number | null;
  @ApiProperty({ nullable: true, type: Number }) cancelRatePercent!: number | null;
  @ApiProperty({ nullable: true, type: Number }) avgPickupSeconds!: number | null;
}

export class PlatformBrandRowDto extends OverviewRowDto implements PlatformBrandRow {
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['BASIC', 'PRO'] }) plan!: 'BASIC' | 'PRO';
  @ApiProperty() commissionBps!: number;
  @ApiProperty() commissionCents!: number;
  @ApiProperty() previousCommissionCents!: number;
  @ApiProperty() stores!: number;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }) moderationStatus!: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export class BusinessOverviewDto implements BusinessOverview {
  @ApiProperty({ type: () => OverviewPeriodDto }) period!: OverviewPeriodDto;
  @ApiProperty({ type: () => OverviewTotalsDto }) current!: OverviewTotalsDto;
  @ApiProperty({ type: () => OverviewTotalsDto }) previous!: OverviewTotalsDto;
  @ApiProperty({ type: () => OverviewDayDto, isArray: true }) daily!: OverviewDayDto[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) statuses!: Record<string, number>;
  @ApiProperty({ type: () => OverviewRowDto, isArray: true }) byStore!: OverviewRowDto[];
  @ApiProperty() storeComparison!: boolean;
  @ApiProperty({ type: () => OverviewHourDto, isArray: true, nullable: true }) byHour!: OverviewHourDto[] | null;
  @ApiProperty({ type: () => OverviewWeekdayDto, isArray: true, nullable: true })
  byWeekday!: OverviewWeekdayDto[] | null;
}

export class PlatformOverviewDto implements PlatformOverview {
  @ApiProperty({ type: () => OverviewPeriodDto }) period!: OverviewPeriodDto;
  @ApiProperty({ nullable: true, type: String }) currency!: string | null;
  @ApiProperty({ type: String, isArray: true }) currencies!: string[];
  @ApiProperty({ type: () => OverviewTotalsDto }) current!: OverviewTotalsDto;
  @ApiProperty({ type: () => OverviewTotalsDto }) previous!: OverviewTotalsDto;
  @ApiProperty({ type: () => OverviewDayDto, isArray: true }) daily!: OverviewDayDto[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) statuses!: Record<string, number>;
  @ApiProperty({ type: () => PlatformBrandRowDto, isArray: true }) byBrand!: PlatformBrandRowDto[];
  @ApiProperty({ type: () => OverviewHourDto, isArray: true }) byHour!: OverviewHourDto[];
  @ApiProperty({ type: () => OverviewWeekdayDto, isArray: true }) byWeekday!: OverviewWeekdayDto[];
}
