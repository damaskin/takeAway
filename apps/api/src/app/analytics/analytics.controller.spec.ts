import { Role } from '@prisma/client';
import type { PlanFeature } from '@takeaway/shared-types';

import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { resolveDateRange } from './analytics-range';
import type { AnalyticsScopeResolver } from './analytics-scope';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';
import type { OverviewService } from './overview.service';

const OWNER: AuthenticatedUser = { id: 'u1', role: Role.BRAND_ADMIN, email: null, phone: null, name: null };

describe('AnalyticsController.overview', () => {
  function controller(features: PlanFeature[]) {
    const range = resolveDateRange({ days: 30 }, 'Europe/Chisinau', 30);
    const scopes = {
      context: jest.fn().mockResolvedValue({
        scope: { brandIds: ['b1'], storeIds: ['s1'] },
        range,
        features: new Set(features),
      }),
    } as unknown as AnalyticsScopeResolver;
    const overviews = { business: jest.fn().mockResolvedValue({}) };
    const ctrl = new AnalyticsController({} as AnalyticsService, scopes, overviews as unknown as OverviewService);
    return { ctrl, scopes, overviews, range };
  }

  it('reads the caller scope and gives a BASIC brand no comparison and no load', async () => {
    const { ctrl, scopes, overviews, range } = controller(['dashboard', 'storeAnalytics']);
    await ctrl.overview(OWNER, { brandId: 'b1', storeId: 's1', days: 30 });
    expect(scopes.context).toHaveBeenCalledWith(OWNER, { brandId: 'b1', storeId: 's1', days: 30 }, 30);
    expect(overviews.business).toHaveBeenCalledWith({ brandIds: ['b1'], storeIds: ['s1'] }, range, {
      storeComparison: false,
      deep: false,
    });
  });

  it('turns on the PRO parts with the plan features', async () => {
    const { ctrl, overviews } = controller(['storeComparison', 'deepAnalytics']);
    await ctrl.overview(OWNER, {});
    expect(overviews.business.mock.calls[0]?.[2]).toEqual({ storeComparison: true, deep: true });
  });
});
