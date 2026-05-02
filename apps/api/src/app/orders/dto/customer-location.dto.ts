import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsLatitude, IsLongitude, IsOptional } from 'class-validator';

export class CustomerLocationDto {
  @ApiProperty({ example: 55.7558 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 37.6173 })
  @IsLongitude()
  lng!: number;

  /**
   * Set to `true` when the user explicitly tapped "I'm here". Forces a
   * `CUSTOMER_HERE` event regardless of the haversine bucket — covers cases
   * where GPS drift would otherwise leave them stuck in NEARBY.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  iAmHere?: boolean;
}

export class CustomerLocationResultDto {
  @ApiProperty({ enum: ['FAR', 'NEARBY', 'HERE'] })
  level!: 'FAR' | 'NEARBY' | 'HERE';

  @ApiProperty({ description: 'Distance to the store in meters.' })
  distanceM!: number;

  @ApiProperty({ description: 'True when the call recorded a new event (one-shot per level).' })
  recorded!: boolean;
}
