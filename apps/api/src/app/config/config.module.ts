import { Global, Module } from '@nestjs/common';

import { AgroprombankQrConfig } from '../payments/agroprombank-qr/agroprombank-qr.config';
import { ConfigController } from './config.controller';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Exposes FeatureFlagsService globally so any module (orders, catalog,
 * delivery) can read flags without importing this module explicitly.
 */
@Global()
@Module({
  controllers: [ConfigController],
  // AgroprombankQrConfig reads nothing but the environment; the flags need
  // only whether the QR payment is on and configured.
  providers: [FeatureFlagsService, AgroprombankQrConfig],
  exports: [FeatureFlagsService],
})
export class FeaturesModule {}
