import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  KitchenDeviceBinding,
  KitchenDeviceStores,
  KitchenDeviceSummary,
  KitchenPairingCode,
} from '@takeaway/shared-types';
import { IsString, Length } from 'class-validator';

/** The header a bound kitchen tablet sends its token in. */
export const KITCHEN_DEVICE_HEADER = 'x-kitchen-device';

export class BindKitchenDeviceDto {
  @ApiProperty({ description: 'A store the signed-in employee works at; the tablet is bound to its brand.' })
  @IsString()
  @Length(1, 64)
  storeId!: string;
}

export class RedeemKitchenPairingDto {
  @ApiProperty({ description: 'The one-time code from the tablet link on the Staff page.' })
  @IsString()
  @Length(16, 128)
  code!: string;
}

export class KitchenDeviceBindingDto implements KitchenDeviceBinding {
  @ApiProperty({ description: 'Long-lived tablet token; the tablet keeps it and sends it as X-Kitchen-Device.' })
  deviceToken!: string;

  @ApiProperty()
  brandId!: string;

  @ApiProperty()
  brandName!: string;
}

class KitchenDeviceStoreDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  city!: string;
}

export class KitchenDeviceStoresDto implements KitchenDeviceStores {
  @ApiProperty()
  brandId!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty({ type: [KitchenDeviceStoreDto], description: 'Stores of the brand where someone has a working PIN' })
  stores!: KitchenDeviceStoreDto[];
}

export class KitchenDeviceSummaryDto implements KitchenDeviceSummary {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  createdByName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastUsedAt!: string | null;
}

export class KitchenPairingCodeDto implements KitchenPairingCode {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  expiresAt!: string;
}
