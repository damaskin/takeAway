import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BrandPlanService } from './brand-plan.service';
import { PlanFeatureGuard } from './plan-feature.guard';

/**
 * Global so any controller can put `@RequiresPlanFeature` on a route without
 * importing this module: the guard resolves its dependencies from here.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [BrandPlanService, PlanFeatureGuard],
  exports: [BrandPlanService, PlanFeatureGuard],
})
export class PlansModule {}
