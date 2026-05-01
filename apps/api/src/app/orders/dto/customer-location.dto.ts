import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CustomerLocationDto {
  @ApiProperty({ minimum: -90, maximum: 90 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  /** True when the customer explicitly taps "I'm here" — escalates to CUSTOMER_HERE regardless of distance. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  iAmHere?: boolean;
}

export class CustomerLocationResultDto {
  @ApiProperty()
  recorded!: boolean;

  @ApiProperty({ enum: ['FAR', 'NEARBY', 'HERE'] })
  proximity!: 'FAR' | 'NEARBY' | 'HERE';

  @ApiProperty({ nullable: true, type: Number })
  distanceM!: number | null;
}
