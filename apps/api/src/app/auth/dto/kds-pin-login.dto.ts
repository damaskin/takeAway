import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { KdsPinLoginRequest } from '@takeaway/shared-types';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class KdsPinLoginDto implements KdsPinLoginRequest {
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

  /**
   * The PIN comes first and the store after, so this is optional. Older
   * tablets send the store they picked; a tablet also sends it after 409
   * `KDS_PIN_STORE_REQUIRED` (an old store PIN two people share).
   */
  @ApiPropertyOptional({
    description: 'A store of the tablet’s brand to open the board on. Required only after 409 KDS_PIN_STORE_REQUIRED.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  storeId?: string;
}
