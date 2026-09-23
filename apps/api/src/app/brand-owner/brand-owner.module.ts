import { Module } from '@nestjs/common';

import { OnboardingModule } from '../onboarding/onboarding.module';
import { BrandOwnerController } from './brand-owner.controller';
import { BrandOwnerService } from './brand-owner.service';

@Module({
  imports: [OnboardingModule],
  controllers: [BrandOwnerController],
  providers: [BrandOwnerService],
})
export class BrandOwnerModule {}
