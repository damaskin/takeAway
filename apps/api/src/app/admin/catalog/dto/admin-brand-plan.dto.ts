import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BrandPlan } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class SetBrandPlanDto {
  @ApiProperty({ enum: BrandPlan })
  @IsEnum(BrandPlan)
  plan!: BrandPlan;

  /**
   * Commission in basis points (1250 = 12.5 %). Left out, the brand gets the
   * plan's default: 1000 on BASIC, 1500 on PRO.
   */
  @ApiPropertyOptional({ minimum: 0, maximum: 5000, description: 'Basis points; defaults to the plan rate.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  commissionBps?: number;
}
