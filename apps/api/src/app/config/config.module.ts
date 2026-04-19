import { Global, Module } from '@nestjs/common';

import { ConfigController } from './config.controller';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Exposes FeatureFlagsService globally so any module (orders, catalog,
 * delivery) can read flags without importing this module explicitly.
 */
@Global()
@Module({
  controllers: [ConfigController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeaturesModule {}
