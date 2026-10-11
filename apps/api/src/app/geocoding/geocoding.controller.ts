import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';

import { Roles } from '../auth/decorators/roles.decorator';
import {
  GeocodeQueryDto,
  GeocodeResponseDto,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
} from './dto/geocode.dto';
import { GeocodingService } from './geocoding.service';

// Per IP, on top of the one-request-a-second pacing towards the geocoder.
// The form debounces typing, so a person stays far below this.
const LOOKUPS_PER_MINUTE = 30 * (process.env['NODE_ENV'] !== 'production' ? 10 : 1);

/**
 * Address lookup for the store form: whoever may create or edit a store.
 * The answers come from OpenStreetMap; see {@link GeocodingService}.
 */
@ApiTags('admin: geocode')
@ApiBearerAuth()
@Controller('admin/geocode')
@Roles(Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER)
@Throttle({ default: { limit: LOOKUPS_PER_MINUTE, ttl: 60_000 } })
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get()
  @ApiOkResponse({ type: GeocodeResponseDto })
  @ApiServiceUnavailableResponse({ description: '`GEOCODER_UNAVAILABLE` — the geocoder is down, slow or busy.' })
  async locate(@Query() query: GeocodeQueryDto): Promise<GeocodeResponseDto> {
    return { result: await this.geocoding.locate(query) };
  }

  @Get('reverse')
  @ApiOkResponse({ type: ReverseGeocodeResponseDto })
  @ApiServiceUnavailableResponse({ description: '`GEOCODER_UNAVAILABLE` — the geocoder is down, slow or busy.' })
  async reverse(@Query() query: ReverseGeocodeQueryDto): Promise<ReverseGeocodeResponseDto> {
    return { result: await this.geocoding.suggestAddress(query.lat, query.lng) };
  }
}
