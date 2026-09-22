import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Currency, PickupPointType, StoreFulfillment, StoreStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { IsIanaTimeZone } from '../../../common/time/time-zone';

/** Most photos a store's gallery holds. */
export const MAX_STORE_GALLERY_IMAGES = 8;

/** Lower-case latin, digits and single hyphens — it becomes the /stores/<slug> URL. */
export const STORE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One row per weekday: a second row for the same day would hit the unique index. */
const eachWeekdayOnce = ArrayUnique((h: WorkingHourInputDto | null) => h?.weekday, {
  message: '$property must list each weekday at most once',
});

export class WorkingHourInputDto {
  @ApiProperty({ description: '0 = Sunday, 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({ description: 'Minutes since local midnight' })
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  opensAt!: number;

  @ApiProperty({
    description:
      'Minutes since local midnight; 1440 is midnight at the end of the day. At or before opensAt the window runs past midnight.',
  })
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  closesAt!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}

export class CreateStoreDto {
  @ApiProperty()
  @IsString()
  brandId!: string;

  @ApiPropertyOptional({
    description:
      'Public address of the store page, /stores/<slug>. Generated from the brand and store name when omitted.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Matches(STORE_SLUG_PATTERN, { message: 'slug may only contain lower-case latin letters, digits and single hyphens' })
  slug?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty()
  @IsString()
  addressLine!: string;

  @ApiProperty()
  @IsString()
  city!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2' })
  @IsString()
  @Length(2, 2)
  country!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({
    example: 'Europe/Chisinau',
    description: "IANA time zone the working hours are in. Defaults to the zone of the brand's other stores.",
  })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ enum: Currency, description: "Defaults to the brand's currency." })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  // Optional so the simple "create store" form doesn't have to surface the
  // pickup machinery up front — defaults to [TAKEAWAY] in the service. The
  // store-editor lets ops widen it later.
  @ApiPropertyOptional({ enum: StoreFulfillment, isArray: true, default: ['TAKEAWAY'] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(StoreFulfillment, { each: true })
  fulfillmentTypes?: StoreFulfillment[];

  @ApiPropertyOptional({ enum: PickupPointType, default: 'COUNTER' })
  @IsOptional()
  @IsEnum(PickupPointType)
  pickupPointType?: PickupPointType;

  @ApiPropertyOptional({ minimum: 0, description: 'Smallest order the store accepts, in cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderCents?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 3600,
    description: 'Fixed per-order overhead in seconds. The queue wait is added on top.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  baseEtaSeconds?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    description: 'Orders this kitchen genuinely works at once. Drives how fast a rush drains.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  kitchenParallelism?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description: 'Most handovers this store will promise inside one 15-minute slot, ASAP orders included.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  slotCapacity?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10000,
    description: 'Sales tax in basis points: 500 = 5%, 2000 = 20%. 0 removes the tax line.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  taxRateBps?: number;

  @ApiPropertyOptional({
    description:
      'True where the menu price already contains the tax (UAE, UK, EU); false where it is added at the till.',
  })
  @IsOptional()
  @IsBoolean()
  taxIncludedInPrice?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  heroImageUrl?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_STORE_GALLERY_IMAGES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STORE_GALLERY_IMAGES)
  @IsUrl({}, { each: true })
  galleryUrls?: string[];

  // Per-store delivery economics. Null clears the override, so the store
  // inherits the platform's DELIVERY_FEE_* defaults again.
  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'Delivery fee before distance, in cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  deliveryFeeBaseCents?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'Delivery fee per kilometre, in cents.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  deliveryFeePerKmCents?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'Radius delivered at the base fee, in metres.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  deliveryFreeRadiusM?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'Farthest the store delivers, in metres.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  deliveryMaxRadiusM?: number | null;

  @ApiPropertyOptional({ type: [WorkingHourInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @eachWeekdayOnce
  @ValidateNested({ each: true })
  @Type(() => WorkingHourInputDto)
  workingHours?: WorkingHourInputDto[];
}

/**
 * A store stays in its brand: `brandId` is not updatable. `status` is set
 * here only — a new store always starts CLOSED.
 */
export class UpdateStoreDto extends PartialType(OmitType(CreateStoreDto, ['brandId'] as const)) {
  @ApiPropertyOptional({
    enum: StoreStatus,
    description: 'Opening a CLOSED store is refused with 409 until it passes the readiness checks.',
  })
  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;
}

export class ReplaceWorkingHoursDto {
  @ApiProperty({
    type: [WorkingHourInputDto],
    description: 'At most one row per weekday. Open around the clock is seven 0–1440 rows.',
  })
  @IsArray()
  @ArrayMaxSize(7)
  @eachWeekdayOnce
  @ValidateNested({ each: true })
  @Type(() => WorkingHourInputDto)
  hours!: WorkingHourInputDto[];
}

export const STORE_IMAGE_KINDS = ['hero', 'gallery'] as const;
export type StoreImageKind = (typeof STORE_IMAGE_KINDS)[number];

export class StoreImageQueryDto {
  @ApiProperty({
    enum: STORE_IMAGE_KINDS,
    description: 'hero = the cover photo, gallery = one more photo in the gallery',
  })
  @IsIn(STORE_IMAGE_KINDS)
  kind!: StoreImageKind;
}

export class RemoveStoreImageQueryDto extends StoreImageQueryDto {
  @ApiPropertyOptional({ description: 'The gallery photo to remove; required for kind=gallery.' })
  @ValidateIf((q: RemoveStoreImageQueryDto) => q.kind === 'gallery')
  @IsString()
  @Length(1, 2048)
  url?: string;
}
