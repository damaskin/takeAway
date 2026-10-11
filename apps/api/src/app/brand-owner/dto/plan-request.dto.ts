import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BrandPlan } from '@prisma/client';
import { FEEDBACK_MESSAGE_MAX_LENGTH } from '@takeaway/shared-types';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** «Перейти на PRO». */
export class CreatePlanRequestDto {
  @ApiProperty({ enum: BrandPlan, example: BrandPlan.PRO })
  @IsEnum(BrandPlan)
  plan!: BrandPlan;

  @ApiPropertyOptional({ description: 'Anything the owner wants the platform team to know.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsOptional()
  @IsString()
  @MaxLength(FEEDBACK_MESSAGE_MAX_LENGTH)
  note?: string;
}

/** The standing request, as the plan card shows it. */
export class PlanRequestDto {
  @ApiProperty({ enum: BrandPlan })
  requestedPlan!: BrandPlan;

  @ApiProperty()
  planRequestedAt!: string;
}
