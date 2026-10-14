import { ApiProperty } from '@nestjs/swagger';
import { Currency, PickupPointType, StoreFulfillment, StoreKind, StoreStatus } from '@prisma/client';
import type { AsapBlockedReason } from '@takeaway/shared-types';

const ASAP_BLOCKED_REASONS: readonly AsapBlockedReason[] = ['OUTSIDE_HOURS', 'SHIFT_CLOSED', 'QUEUE_FULL'];

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
    description:
      "The brand's logo. The store's own photo is heroImageUrl; a store card falls back to this logo only " +
      'when the store has no photo (heroImageUrl ?? logoUrl).',
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

  @ApiProperty({
    description:
      'ETA for an ASAP order, in seconds: store overhead plus the queue due now, pushed to the first 15-minute ' +
      'slot with room.',
  })
  currentEtaSeconds!: number;

  @ApiProperty({
    description:
      'True while the store takes some order: an ASAP one now (openNow) or a pre-order for a bookable slot in ' +
      'the next 24 hours — also while the shift is closed. False (store switched off, or no working hours in ' +
      'the next day) means the store is shown as inactive and checkout is refused with STORE_NOT_TAKING_ORDERS.',
  })
  acceptingOrders!: boolean;

  @ApiProperty({
    description:
      'True when an ASAP order placed now would be accepted: not switched off, a shift is open, within the ' +
      'working hours (or the kitchen extended past them) and the queue hands it over within ' +
      'MAX_ASAP_WAIT_SECONDS. Working hours win over the shift (kitchen policy 2026-10-14).',
  })
  openNow!: boolean;

  @ApiProperty({
    enum: [...ASAP_BLOCKED_REASONS],
    nullable: true,
    type: String,
    description:
      'Why openNow is false: OUTSIDE_HOURS (no extension), then SHIFT_CLOSED, then QUEUE_FULL. Null when ' +
      'openNow, and for a store switched off (acceptingOrders says it).',
  })
  asapBlockedReason!: AsapBlockedReason | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'ISO UTC start of the next working-hours window while outside the hours (a week ahead), else null.',
  })
  opensAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'ISO UTC end of the current working-hours window while within the hours; null outside them and for a ' +
      'store open around the clock.',
  })
  closesAt!: string | null;

  @ApiProperty({ description: 'Sales tax in basis points: 500 = 5%, 2000 = 20%. 0 = no tax line.' })
  taxRateBps!: number;

  @ApiProperty({ description: 'True when the listed prices already include the tax.' })
  taxIncludedInPrice!: boolean;

  @ApiProperty({ enum: Currency })
  currency!: Currency;

  @ApiProperty({ description: 'IANA zone of the store. Pickup and opening times are shown on its clock.' })
  timezone!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "The store's own photo (cover), uploaded in the admin. Null when it has none — show logoUrl then.",
  })
  heroImageUrl!: string | null;

  @ApiProperty({
    enum: StoreKind,
    isArray: true,
    description:
      'What the store sells, for map markers and filters. Never empty; clients treat a missing list as coffee.',
  })
  kinds!: StoreKind[];

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

  /**
   * Always null: every brand shows in the one takeAway style since
   * 2026-10-11. Kept on the wire for the app builds that read it.
   */
  @ApiProperty({
    nullable: true,
    type: Object,
    deprecated: true,
    description: 'Always null — brands no longer recolour the storefronts.',
  })
  themeOverrides!: null;
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
