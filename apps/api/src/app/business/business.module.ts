import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';

@Module({
  imports: [AuthModule, OnboardingModule],
  controllers: [BusinessController],
  providers: [BusinessService],
})
export class BusinessModule {}
