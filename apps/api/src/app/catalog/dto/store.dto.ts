import { ApiProperty } from '@nestjs/swagger';
import { Currency, PickupPointType, StoreFulfillment, StoreStatus } from '@prisma/client';

export class StoreWorkingHourDto {
  @ApiProperty({ description: '0 = Sunday, 6 = Saturday' })
  weekday!: number;

  @ApiProperty({ description: 'Minutes since local midnight' })
  opensAt!: number;

  @ApiProperty({ description: 'Minutes since local midnight' })
  closesAt!: number;

  @ApiProperty()
  isClosed!: boolean;
}

export class StoreListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  brandId!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  addressLine!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  country!: string;

  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty({ enum: StoreStatus })
  status!: StoreStatus;

  @ApiProperty({ enum: StoreFulfillment, isArray: true })
  fulfillmentTypes!: StoreFulfillment[];

  @ApiProperty({ enum: PickupPointType })
  pickupPointType!: PickupPointType;

  @ApiProperty({ description: '0..100' })
  busyMeter!: number;

  @ApiProperty({ description: 'ETA for an ASAP order, in seconds' })
  currentEtaSeconds!: number;

  @ApiProperty({ enum: Currency })
  currency!: Currency;

  @ApiProperty({ nullable: true, type: String })
  heroImageUrl!: string | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Distance from query point in meters, if lat/lng passed' })
  distanceMeters!: number | null;
}

export class BrandThemeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  logoUrl!: string | null;

  /** Map of `{ "--css-var": "value" }` overrides for the TMA theme. */
  @ApiProperty({
    nullable: true,
    type: Object,
    description: 'CSS variable overrides applied on top of the Telegram theme',
  })
  themeOverrides!: Record<string, string> | null;
}

export class StoreDetailDto extends StoreListItemDto {
  @ApiProperty()
  timezone!: string;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty()
  minOrderCents!: number;

  @ApiProperty({ type: [String] })
  galleryUrls!: string[];

  @ApiProperty({ type: [StoreWorkingHourDto] })
  workingHours!: StoreWorkingHourDto[];

  @ApiProperty({ type: BrandThemeDto })
  brand!: BrandThemeDto;
}
