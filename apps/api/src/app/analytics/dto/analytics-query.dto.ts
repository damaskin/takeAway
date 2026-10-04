import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { ISO_DAY } from '../analytics-range';
import { CHURN_WINDOWS, type ChurnWindow } from '../retention';

/**
 * The period and the slice of the business an analytics request covers.
 * `from`/`to` are calendar days in the brand's (or the store's) time zone;
 * `days` is the older way to say "that many days ending today".
 */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'One of your brands; SUPER_ADMIN: any brand, all when omitted.' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Narrows the figures to one store in scope.' })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'First day, local to the brand.' })
  @IsOptional()
  @Matches(ISO_DAY, { message: 'from must be a date like 2026-10-04' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Last day, included.' })
  @IsOptional()
  @Matches(ISO_DAY, { message: 'to must be a date like 2026-10-04' })
  to?: string;

  @ApiPropertyOptional({ description: 'Days ending today, when from/to are not given.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  days?: number;
}

export class TopProductsQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}

export class RetentionQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: CHURN_WINDOWS, description: 'Days without an order after which a customer is lost.' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([...CHURN_WINDOWS])
  window?: ChurnWindow;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'How many customers to list.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
