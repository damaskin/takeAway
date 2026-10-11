import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class KdsPinLoginDto {
  @ApiProperty({ description: 'Store id picked on the kitchen tablet; must belong to the tablet’s brand.' })
  @IsString()
  @Length(1, 64)
  storeId!: string;

  @ApiProperty({ description: '4–6 digit numeric PIN (new PINs are 6 digits; older 4–5 digit ones still work).' })
  @IsString()
  @Matches(/^[0-9]{4,6}$/, { message: 'pin must be 4 to 6 digits' })
  pin!: string;

  /**
   * Token of the bound tablet. Optional in the schema only so a request
   * without it gets the actionable 401 `KDS_DEVICE_REQUIRED` rather than a
   * validation error: PIN sign-in works from bound tablets only.
   */
  @ApiPropertyOptional({ description: 'Token of the bound kitchen tablet (from POST /auth/kds/device or /pair).' })
  @IsOptional()
  @IsString()
  @Length(16, 256)
  deviceToken?: string;
}
