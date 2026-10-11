import { Module } from '@nestjs/common';

import { GeocodingController } from './geocoding.controller';
import { GeocodingService } from './geocoding.service';

/** Address ↔ map point for the admin's store form, through OpenStreetMap's geocoder. */
@Module({
  controllers: [GeocodingController],
  providers: [GeocodingService],
})
export class GeocodingModule {}
