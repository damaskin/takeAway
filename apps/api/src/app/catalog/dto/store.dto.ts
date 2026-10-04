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

  @ApiProperty({ description: 'Name of the business the store belongs to, for the store card and menu header.' })
  brandName!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "Logo shown on the store card. Stores have no logo of their own yet, so this is the brand's.",
  })
  logoUrl!: string | null;

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

  @ApiProperty({ description: 'ETA for an ASAP order, in seconds. Store overhead plus the live queue.' })
  currentEtaSeconds!: number;

  @ApiProperty({
    description:
      'True while the store takes orders at all: it is not closed and staff have started a shift ' +
      '("Start work"). False means the store is shown as inactive and checkout is refused.',
  })
  acceptingOrders!: boolean;

  @ApiProperty({
    description:
      'True when an ASAP order placed now would be accepted. The shift is the source of truth: same as ' +
      'acceptingOrders (not closed and a shift is open), whatever the working hours say. Working hours only ' +
      'decide which pickup slots are offered for scheduled (later) orders.',
  })
  openNow!: boolean;

  @ApiProperty({ description: 'Sales tax in basis points: 500 = 5%, 2000 = 20%. 0 = no tax line.' })
  taxRateBps!: number;

  @ApiProperty({ description: 'True when the listed prices already include the tax.' })
  taxIncludedInPrice!: boolean;

  @ApiProperty({ enum: Currency })
  currency!: Currency;

  @ApiProperty({ description: 'IANA zone of the store. Pickup and opening times are shown on its clock.' })
  timezone!: string;

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
